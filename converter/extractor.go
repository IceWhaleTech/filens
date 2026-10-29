// Package converter hosts the optional FiLens text WASM module. All format
// policy and parsing are implemented by that module, including PDF page/OCR
// decisions. The host only invokes WASM engines and injected capabilities.
package converter

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	pdferrors "github.com/klippa-app/go-pdfium/errors"
	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
	"github.com/tetratelabs/wazero/imports/wasi_snapshot_preview1"
	"github.com/tetratelabs/wazero/sys"
)

const Version = "filens-text-v1"
const MaxContentBytes = 32 << 20
const DefaultContentBytes = 8 << 20

type OCRProvider interface {
	Recognize(context.Context, string) (string, error)
}
type OCRLayoutProvider interface {
	RecognizeLayout(context.Context, string) (json.RawMessage, error)
}
type Options struct {
	MaxBytes         int    `json:"maxBytes"`
	MaxOCRPages      int    `json:"maxOCRPages"`
	IncludeStructure bool   `json:"includeStructure,omitempty"`
	IncludeLayout    bool   `json:"includeLayout,omitempty"`
	OutputFormat     string `json:"outputFormat,omitempty"`
}

// Document spans address extracted UTF-8 text, with zero-based byte offsets
// (end exclusive) and one-based line numbers. They are not source page numbers.
type Document struct {
	Bytes      int         `json:"bytes"`
	Characters int         `json:"characters"`
	Lines      int         `json:"lines"`
	Blocks     []TextBlock `json:"blocks"`
}
type TextBlock struct {
	ID        string `json:"id"`
	StartByte int    `json:"startByte"`
	EndByte   int    `json:"endByte"`
	StartLine int    `json:"startLine"`
	EndLine   int    `json:"endLine"`
}
type Result struct {
	Text         string          `json:"text"`
	Complete     bool            `json:"complete"`
	Truncated    bool            `json:"truncated"`
	Warnings     []string        `json:"warnings,omitempty"`
	ErrorCode    string          `json:"errorCode,omitempty"`
	ErrorMessage string          `json:"errorMessage,omitempty"`
	Document     *Document       `json:"document,omitempty"`
	Layout       json.RawMessage `json:"layout,omitempty"`
	Rendered     string          `json:"rendered,omitempty"`
}

func (r Result) Err() error {
	if r.Complete {
		return nil
	}
	return &ExtractionError{Code: r.ErrorCode, Message: r.ErrorMessage}
}

type ExtractionError struct{ Code, Message string }

func (e *ExtractionError) Error() string { return e.Code + ": " + e.Message }

type Config struct {
	WASM    []byte
	OCR     OCRProvider
	TempDir string
	Stderr  io.Writer
}
type Extractor struct {
	mu       sync.Mutex
	runtime  wazero.Runtime
	compiled wazero.CompiledModule
	config   Config
	work     string
	pdf      *pdfBridge
}

func NewExtractor(ctx context.Context, config Config) (*Extractor, error) {
	if len(config.WASM) == 0 {
		return nil, errors.New("text extraction WASM is required")
	}
	if config.Stderr == nil {
		config.Stderr = io.Discard
	}
	runtime := wazero.NewRuntimeWithConfig(ctx, wazero.NewRuntimeConfig().WithCloseOnContextDone(true).WithMemoryLimitPages(8192))
	e := &Extractor{runtime: runtime, config: config}
	fail := func(err error) (*Extractor, error) { _ = runtime.Close(ctx); return nil, err }
	if _, err := wasi_snapshot_preview1.Instantiate(ctx, runtime); err != nil {
		return fail(err)
	}
	if _, err := runtime.NewHostModuleBuilder("filens_text").NewFunctionBuilder().WithFunc(e.hostCall).Export("host_call").Instantiate(ctx); err != nil {
		return fail(err)
	}
	compiled, err := runtime.CompileModule(ctx, config.WASM)
	if err != nil {
		return fail(fmt.Errorf("compile text WASM: %w", err))
	}
	e.compiled = compiled
	return e, nil
}
func (e *Extractor) Close(ctx context.Context) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.pdf != nil {
		e.pdf.close()
	}
	return e.runtime.Close(ctx)
}

func (e *Extractor) ExtractText(ctx context.Context, input string, options Options) (Result, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if options.MaxBytes <= 0 {
		options.MaxBytes = DefaultContentBytes
	}
	if options.MaxBytes > MaxContentBytes {
		options.MaxBytes = MaxContentBytes
	}
	if options.MaxOCRPages <= 0 || options.MaxOCRPages > 200 {
		options.MaxOCRPages = 200
	}
	result := Result{}
	info, err := os.Stat(input)
	if err != nil {
		return result, err
	}
	if !info.Mode().IsRegular() || info.Size() > 256<<20 {
		return result, &ExtractionError{Code: "io_error", Message: "input must be a regular file no larger than 256 MiB"}
	}
	work, err := os.MkdirTemp(e.config.TempDir, "filens-text-*")
	if err != nil {
		return result, err
	}
	defer os.RemoveAll(work)
	e.work = work
	defer func() {
		if e.pdf != nil {
			e.pdf.closeDocument()
		}
		e.work = ""
	}()
	source := strings.TrimPrefix(strings.ToLower(filepath.Ext(input)), ".")
	workInput := filepath.Join(work, "input."+source)
	from, err := os.Open(input)
	if err != nil {
		return result, err
	}
	to, err := os.OpenFile(workInput, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		from.Close()
		return result, err
	}
	_, copyErr := io.Copy(to, io.LimitReader(from, (256<<20)+1))
	closeErr := to.Close()
	from.Close()
	if err = errors.Join(copyErr, closeErr); err != nil {
		return result, err
	}
	if after, err := os.Stat(workInput); err != nil || after.Size() > 256<<20 {
		return result, errors.New("input changed or exceeded size limit while copying")
	}
	optionsBytes, _ := json.Marshal(options)
	if err = os.WriteFile(filepath.Join(work, "options.json"), optionsBytes, 0600); err != nil {
		return result, err
	}
	config := wazero.NewModuleConfig().WithName("").WithArgs("converter-text", "--operation", "extract-text", "--input", "/work/input."+source, "--output", "/work/text.txt", "--source", source, "--target", "text", "--options", "/work/options.json", "--result", "/work/result.json").WithFSConfig(wazero.NewFSConfig().WithDirMount(work, "/work")).WithStdout(e.config.Stderr).WithStderr(e.config.Stderr)
	instance, runErr := e.runtime.InstantiateModule(ctx, e.compiled, config)
	if instance != nil {
		_ = instance.Close(context.Background())
	}
	var exit *sys.ExitError
	if runErr != nil && !(errors.As(runErr, &exit) && exit.ExitCode() == 0) {
		return result, fmt.Errorf("run text WASM: %w", runErr)
	}
	file, err := os.Open(filepath.Join(work, "result.json"))
	if err != nil {
		return result, err
	}
	defer file.Close()
	var wire struct {
		Payload      *Result `json:"payload"`
		ErrorCode    string  `json:"errorCode"`
		ErrorMessage string  `json:"errorMessage"`
	}
	if err = json.NewDecoder(io.LimitReader(file, 128<<20)).Decode(&wire); err != nil {
		return result, fmt.Errorf("decode extraction result: %w", err)
	}
	if wire.Payload == nil {
		return result, &ExtractionError{Code: wire.ErrorCode, Message: wire.ErrorMessage}
	}
	result = *wire.Payload
	return result, result.Err()
}

func (e *Extractor) hostCall(ctx context.Context, m api.Module, ptr, length, out, capacity uint32) uint32 {
	respond := func(value any) uint32 {
		data, err := json.Marshal(value)
		if err != nil {
			return 0
		}
		if uint32(len(data)) > capacity || !m.Memory().Write(out, data) {
			return 0
		}
		return uint32(len(data))
	}
	data, ok := m.Memory().Read(ptr, length)
	if !ok || length > 64<<10 {
		return 0
	}
	var request struct {
		Operation string `json:"operation"`
		Path      string `json:"path"`
		Page      int    `json:"page"`
		DPI       int    `json:"dpi"`
		Layout    bool   `json:"layout"`
	}
	if err := json.Unmarshal(data, &request); err != nil {
		return respond(map[string]string{"error": err.Error()})
	}
	localPath := func(path string) (string, error) {
		clean := filepath.ToSlash(filepath.Clean(path))
		if !strings.HasPrefix(clean, "/work/") {
			return "", errors.New("capability path must be inside /work")
		}
		rel := strings.TrimPrefix(clean, "/work/")
		if strings.Contains(rel, "/") {
			return "", errors.New("capability paths must be flat")
		}
		return filepath.Join(e.work, rel), nil
	}
	var err error
	switch request.Operation {
	case "ocr":
		if e.config.OCR == nil {
			return respond(map[string]string{"error": "OCR provider is unavailable"})
		}
		var path, text string
		path, err = localPath(request.Path)
		if err == nil {
			ocrCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
			defer cancel()
			if detailed, ok := e.config.OCR.(OCRLayoutProvider); request.Layout && ok {
				value, detailErr := detailed.RecognizeLayout(ocrCtx, path)
				if detailErr == nil {
					return respond(value)
				}
				return respond(map[string]string{"error": detailErr.Error()})
			}
			text, err = e.config.OCR.Recognize(ocrCtx, path)
		}
		if err == nil {
			return respond(map[string]string{"text": text})
		}
	case "pdf_open", "pdf_text", "pdf_render", "pdf_layout":
		if e.pdf == nil {
			e.pdf = &pdfBridge{}
		}
		var path string
		if request.Path != "" {
			path, err = localPath(request.Path)
		}
		if err == nil {
			var value any
			value, err = e.pdf.call(ctx, request.Operation, path, request.Page, request.DPI)
			if err == nil {
				return respond(value)
			}
		}
	default:
		err = errors.New("unknown extraction capability")
	}
	code := "engine_unavailable"
	if errors.Is(err, pdferrors.ErrPassword) {
		code = "password_required"
	} else if errors.Is(err, pdferrors.ErrFormat) {
		code = "parse_error"
	}
	return respond(map[string]string{"error": err.Error(), "errorCode": code})
}
