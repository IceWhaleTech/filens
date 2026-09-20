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

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/imports/wasi_snapshot_preview1"
	"github.com/tetratelabs/wazero/sys"
)

type Options struct {
	Password string `json:"password,omitempty"`
	Locale   string `json:"locale,omitempty"`
}

type Metrics struct {
	ElapsedMs int64 `json:"elapsedMs"`
	InputSize int64 `json:"inputSize,omitempty"`
}

type Result struct {
	OK           bool     `json:"ok"`
	SourceFormat string   `json:"sourceFormat"`
	TargetFormat string   `json:"targetFormat"`
	Backend      string   `json:"backend,omitempty"`
	Fidelity     string   `json:"fidelity,omitempty"`
	ContentType  string   `json:"contentType,omitempty"`
	Warnings     []string `json:"warnings"`
	ErrorCode    string   `json:"errorCode,omitempty"`
	ErrorMessage string   `json:"errorMessage,omitempty"`
	Metrics      Metrics  `json:"metrics"`
	OutputPath   string   `json:"-"`
	ExitCode     uint32   `json:"-"`
}

func Convert(ctx context.Context, wasmPath string, inputPath string, outputPath string, opts Options) (Result, error) {
	sourceFormat := normalizeFormat(filepath.Ext(inputPath))
	targetFormat := normalizeFormat(filepath.Ext(outputPath))
	return ConvertWithFormats(ctx, wasmPath, inputPath, outputPath, sourceFormat, targetFormat, opts)
}

func ConvertWithFormats(
	ctx context.Context,
	wasmPath string,
	inputPath string,
	outputPath string,
	sourceFormat string,
	targetFormat string,
	opts Options,
) (Result, error) {
	backend := NewWASIBackend()
	defer backend.Close(ctx)
	return backend.convertWithFormats(ctx, wasmPath, inputPath, outputPath, sourceFormat, targetFormat, opts)
}

type cachedWASIModule struct {
	runtime wazero.Runtime
	module  wazero.CompiledModule
}

type WASIBackend struct {
	mu      sync.Mutex
	modules map[string]*cachedWASIModule
}

func NewWASIBackend() *WASIBackend {
	return &WASIBackend{}
}

func (backend *WASIBackend) Name() string {
	return "wasi"
}

func (backend *WASIBackend) Convert(ctx context.Context, request BackendContext) (Result, error) {
	return backend.convertWithFormats(
		ctx,
		request.WasmPath,
		request.InputPath,
		request.OutputPath,
		request.SourceFormat,
		request.TargetFormat,
		request.Options,
	)
}

func (backend *WASIBackend) Close(ctx context.Context) error {
	if backend == nil {
		return nil
	}
	backend.mu.Lock()
	modules := backend.modules
	backend.modules = nil
	backend.mu.Unlock()

	var closeErr error
	for _, module := range modules {
		closeErr = errors.Join(closeErr, module.close(ctx))
	}
	return closeErr
}

func (backend *WASIBackend) convertWithFormats(
	ctx context.Context,
	wasmPath string,
	inputPath string,
	outputPath string,
	sourceFormat string,
	targetFormat string,
	opts Options,
) (Result, error) {
	sourceFormat = normalizeFormat(sourceFormat)
	targetFormat = normalizeFormat(targetFormat)
	if inputPath == "" {
		return Result{}, errors.New("input path is required")
	}
	if outputPath == "" {
		return Result{}, errors.New("output path is required")
	}
	if sourceFormat == "" {
		return Result{}, errors.New("source format is required")
	}
	if targetFormat == "" {
		return Result{}, errors.New("target format is required")
	}
	if !isSupportedConversionPair(sourceFormat, targetFormat) {
		return unsupportedConversionResult(sourceFormat, targetFormat), nil
	}
	if wasmPath == "" {
		return Result{}, errors.New("wasm path is required")
	}

	workDir, err := os.MkdirTemp("", "preview-converter-*")
	if err != nil {
		return Result{}, fmt.Errorf("create work dir: %w", err)
	}
	defer os.RemoveAll(workDir)

	workInput := filepath.Join(workDir, "in."+sourceFormat)
	workOutput := filepath.Join(workDir, "out."+targetFormat)
	workOptions := filepath.Join(workDir, "options.json")
	workResult := filepath.Join(workDir, "result.json")

	if err := copyFile(inputPath, workInput); err != nil {
		return Result{}, err
	}
	optionsBytes, err := json.Marshal(opts)
	if err != nil {
		return Result{}, fmt.Errorf("encode options: %w", err)
	}
	if err := os.WriteFile(workOptions, optionsBytes, 0o644); err != nil {
		return Result{}, fmt.Errorf("write options: %w", err)
	}

	config := wazero.NewModuleConfig().
		WithArgs(
			"converter-core",
			"--input", "/work/"+filepath.Base(workInput),
			"--output", "/work/"+filepath.Base(workOutput),
			"--source", sourceFormat,
			"--target", targetFormat,
			"--options", "/work/"+filepath.Base(workOptions),
			"--result", "/work/"+filepath.Base(workResult),
		).
		WithFSConfig(wazero.NewFSConfig().WithDirMount(workDir, "/work")).
		WithStdout(os.Stdout).
		WithStderr(os.Stderr)

	instantiateErr := backend.instantiate(ctx, wasmPath, config)
	exitCode, runErr := normalizeRunError(instantiateErr)

	res, readErr := readResult(workResult)
	if readErr != nil {
		if runErr != nil {
			return Result{Backend: "wasi", Fidelity: ConversionFidelityWASI, ExitCode: exitCode}, fmt.Errorf("%w; also failed reading result: %v", runErr, readErr)
		}
		return Result{Backend: "wasi", Fidelity: ConversionFidelityWASI, ExitCode: exitCode}, readErr
	}
	res.Backend = "wasi"
	res = markResultFidelity(res)
	res.ExitCode = exitCode

	if res.OK {
		if err := copyFile(workOutput, outputPath); err != nil {
			return res, err
		}
		if err := ValidateOpenXMLOutput(outputPath, res.TargetFormat); err != nil {
			return openXMLValidationFailureResult(markResultBackend(res, "wasi"), outputPath, err), nil
		}
		res.OutputPath = outputPath
	}
	if runErr != nil && res.OK {
		return res, runErr
	}
	return res, nil
}

func (backend *WASIBackend) instantiate(ctx context.Context, wasmPath string, config wazero.ModuleConfig) error {
	module, err := backend.cachedModule(ctx, wasmPath)
	if err != nil {
		return err
	}
	return module.instantiate(ctx, config)
}

func (backend *WASIBackend) cachedModule(ctx context.Context, wasmPath string) (*cachedWASIModule, error) {
	if backend == nil {
		return nil, errors.New("wasi backend is required")
	}
	cacheKey := wasmPath
	if absolutePath, err := filepath.Abs(wasmPath); err == nil {
		cacheKey = filepath.Clean(absolutePath)
	}

	backend.mu.Lock()
	defer backend.mu.Unlock()
	if backend.modules != nil {
		if module := backend.modules[cacheKey]; module != nil {
			return module, nil
		}
	}

	module, err := newCachedWASIModule(ctx, wasmPath)
	if err != nil {
		return nil, err
	}
	if backend.modules == nil {
		backend.modules = map[string]*cachedWASIModule{}
	}
	backend.modules[cacheKey] = module
	return module, nil
}

func newCachedWASIModule(ctx context.Context, wasmPath string) (*cachedWASIModule, error) {
	wasmBytes, err := os.ReadFile(wasmPath)
	if err != nil {
		return nil, fmt.Errorf("read wasm: %w", err)
	}

	runtime := wazero.NewRuntime(ctx)
	if _, err := wasi_snapshot_preview1.Instantiate(ctx, runtime); err != nil {
		_ = runtime.Close(ctx)
		return nil, fmt.Errorf("instantiate WASI: %w", err)
	}
	compiled, err := runtime.CompileModule(ctx, wasmBytes)
	if err != nil {
		_ = runtime.Close(ctx)
		return nil, fmt.Errorf("compile wasm: %w", err)
	}
	return &cachedWASIModule{
		runtime: runtime,
		module:  compiled,
	}, nil
}

func (module *cachedWASIModule) instantiate(ctx context.Context, config wazero.ModuleConfig) error {
	instance, err := module.runtime.InstantiateModule(ctx, module.module, config.WithName(""))
	if instance != nil {
		if closeErr := instance.Close(ctx); err == nil && closeErr != nil {
			return closeErr
		}
	}
	return err
}

func (module *cachedWASIModule) close(ctx context.Context) error {
	if module == nil || module.runtime == nil {
		return nil
	}
	return module.runtime.Close(ctx)
}

func normalizeRunError(err error) (uint32, error) {
	if err == nil {
		return 0, nil
	}
	var exitErr *sys.ExitError
	if errors.As(err, &exitErr) {
		if exitErr.ExitCode() == 0 {
			return 0, nil
		}
		return exitErr.ExitCode(), nil
	}
	return 1, fmt.Errorf("run converter wasm: %w", err)
}

func readResult(path string) (Result, error) {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return Result{}, fmt.Errorf("read result: %w", err)
	}
	var res Result
	if err := json.Unmarshal(bytes, &res); err != nil {
		return Result{}, fmt.Errorf("parse result: %w", err)
	}
	if res.Warnings == nil {
		res.Warnings = []string{}
	}
	return res, nil
}

func copyFile(source string, target string) error {
	input, err := os.Open(source)
	if err != nil {
		return fmt.Errorf("open %s: %w", source, err)
	}
	defer input.Close()

	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return fmt.Errorf("create %s: %w", filepath.Dir(target), err)
	}

	output, err := os.Create(target)
	if err != nil {
		return fmt.Errorf("create %s: %w", target, err)
	}
	_, copyErr := io.Copy(output, input)
	closeErr := output.Close()
	if copyErr != nil {
		return fmt.Errorf("copy %s to %s: %w", source, target, copyErr)
	}
	if closeErr != nil {
		return fmt.Errorf("close %s: %w", target, closeErr)
	}
	return nil
}

func normalizeFormat(format string) string {
	return strings.TrimPrefix(strings.ToLower(strings.TrimSpace(format)), ".")
}
