package converter

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const defaultMaxUploadBytes int64 = 512 << 20

var errUploadTooLarge = errors.New("upload exceeds configured maximum size")

type ConverterFunc func(
	ctx context.Context,
	wasmPath string,
	inputPath string,
	outputPath string,
	sourceFormat string,
	targetFormat string,
	opts Options,
) (Result, error)

type HTTPHandlerOptions struct {
	WasmPath       string
	MaxUploadBytes int64
	BackendChain   BackendChainOptions
	Convert        ConverterFunc
}

type httpHandler struct {
	wasmPath       string
	maxUploadBytes int64
	requiresWASM   bool
	convert        ConverterFunc
}

type conversionHTTPResponse struct {
	OK           bool     `json:"ok"`
	Format       string   `json:"format,omitempty"`
	TargetFormat string   `json:"targetFormat,omitempty"`
	SourceFormat string   `json:"sourceFormat,omitempty"`
	Backend      string   `json:"backend,omitempty"`
	Fidelity     string   `json:"fidelity,omitempty"`
	ContentType  string   `json:"contentType,omitempty"`
	Base64       string   `json:"base64,omitempty"`
	Warnings     []string `json:"warnings,omitempty"`
	ErrorCode    string   `json:"errorCode,omitempty"`
	ErrorMessage string   `json:"errorMessage,omitempty"`
	Metrics      Metrics  `json:"metrics"`
}

func NewHTTPHandler(options HTTPHandlerOptions) http.Handler {
	convert := options.Convert
	if convert == nil {
		convert = NewBackendChain(options.BackendChain).ConverterFunc()
	}
	maxUploadBytes := options.MaxUploadBytes
	if maxUploadBytes <= 0 {
		maxUploadBytes = defaultMaxUploadBytes
	}
	return &httpHandler{
		wasmPath:       options.WasmPath,
		maxUploadBytes: maxUploadBytes,
		requiresWASM:   options.Convert != nil || options.BackendChain.RequiresWASM(),
		convert:        convert,
	}
}

func (handler *httpHandler) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		response.Header().Set("Allow", http.MethodPost)
		writeJSON(response, http.StatusMethodNotAllowed, conversionHTTPResponse{
			OK:           false,
			ErrorCode:    ErrorCodeIO,
			ErrorMessage: "method not allowed",
			Warnings:     []string{},
		})
		return
	}
	tempDir, err := os.MkdirTemp("", "preview-converter-http-*")
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, conversionHTTPResponse{
			OK:           false,
			ErrorCode:    ErrorCodeIO,
			ErrorMessage: fmt.Sprintf("create temp dir: %v", err),
			Warnings:     []string{},
		})
		return
	}
	defer os.RemoveAll(tempDir)

	upload, fields, err := readMultipartUpload(response, request, tempDir, handler.maxUploadBytes)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, errUploadTooLarge) {
			status = http.StatusRequestEntityTooLarge
		}
		writeJSON(response, status, conversionHTTPResponse{
			OK:           false,
			ErrorCode:    ErrorCodeIO,
			ErrorMessage: err.Error(),
			Warnings:     []string{},
		})
		return
	}
	if upload == "" {
		writeJSON(response, http.StatusBadRequest, conversionHTTPResponse{
			OK:           false,
			ErrorCode:    ErrorCodeIO,
			ErrorMessage: "missing multipart file field",
			Warnings:     []string{},
		})
		return
	}

	sourceFormat := normalizeFormat(fields["sourceFormat"])
	if sourceFormat == "" {
		sourceFormat = normalizeFormat(filepath.Ext(fields["name"]))
	}
	targetFormat := normalizeFormat(fields["targetFormat"])
	if sourceFormat == "" || targetFormat == "" {
		writeJSON(response, http.StatusBadRequest, conversionHTTPResponse{
			OK:           false,
			SourceFormat: sourceFormat,
			TargetFormat: targetFormat,
			ErrorCode:    ErrorCodeUnsupportedFormat,
			ErrorMessage: "sourceFormat and targetFormat are required",
			Warnings:     []string{},
		})
		return
	}
	if !isSupportedConversionPair(sourceFormat, targetFormat) {
		result := unsupportedConversionResult(sourceFormat, targetFormat)
		writeJSON(response, HTTPStatusFromResult(result), responseFromResult(result, "", nil))
		return
	}
	if handler.requiresWASM && handler.wasmPath == "" {
		writeJSON(response, http.StatusServiceUnavailable, conversionHTTPResponse{
			OK:           false,
			SourceFormat: sourceFormat,
			TargetFormat: targetFormat,
			Format:       targetFormat,
			ContentType:  contentTypeForFormat(targetFormat),
			ErrorCode:    ErrorCodeEngineUnavailable,
			ErrorMessage: "wasm path is not configured",
			Warnings:     []string{},
		})
		return
	}

	output := filepath.Join(tempDir, "out."+targetFormat)
	result, err := handler.convert(request.Context(), handler.wasmPath, upload, output, sourceFormat, targetFormat, Options{
		Password: fields["password"],
		Locale:   fields["locale"],
	})
	result = markResultFidelity(fillResultFormats(result, sourceFormat, targetFormat))
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, responseFromResult(result, err.Error(), nil))
		return
	}
	if !result.OK {
		writeJSON(response, HTTPStatusFromResult(result), responseFromResult(result, "", nil))
		return
	}

	bytes, err := os.ReadFile(output)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, conversionHTTPResponse{
			OK:           false,
			SourceFormat: result.SourceFormat,
			TargetFormat: result.TargetFormat,
			Backend:      result.Backend,
			Fidelity:     result.Fidelity,
			ErrorCode:    ErrorCodeIO,
			ErrorMessage: fmt.Sprintf("read converted output: %v", err),
			Warnings:     result.Warnings,
			Metrics:      result.Metrics,
		})
		return
	}
	if err := ValidateOpenXMLOutput(output, result.TargetFormat); err != nil {
		failed := openXMLValidationFailureResult(result, output, err)
		writeJSON(response, HTTPStatusFromResult(failed), responseFromResult(failed, "", nil))
		return
	}
	writeJSON(response, http.StatusOK, responseFromResult(result, "", bytes))
}

func readMultipartUpload(
	response http.ResponseWriter,
	request *http.Request,
	tempDir string,
	maxUploadBytes int64,
) (string, map[string]string, error) {
	body := http.MaxBytesReader(response, request.Body, maxUploadBytes)
	defer body.Close()
	request.Body = body

	reader, err := request.MultipartReader()
	if err != nil {
		if isMaxBytesError(err) {
			return "", nil, fmt.Errorf("%w: limit %d bytes", errUploadTooLarge, maxUploadBytes)
		}
		return "", nil, fmt.Errorf("read multipart request: %w", err)
	}

	fields := map[string]string{}
	var uploadPath string
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			if isMaxBytesError(err) {
				return "", nil, fmt.Errorf("%w: limit %d bytes", errUploadTooLarge, maxUploadBytes)
			}
			return "", nil, fmt.Errorf("read multipart part: %w", err)
		}

		name := part.FormName()
		if name == "" {
			part.Close()
			continue
		}
		if name != "file" {
			value, err := io.ReadAll(io.LimitReader(part, 1<<20))
			part.Close()
			if err != nil {
				if isMaxBytesError(err) {
					return "", nil, fmt.Errorf("%w: limit %d bytes", errUploadTooLarge, maxUploadBytes)
				}
				return "", nil, fmt.Errorf("read field %s: %w", name, err)
			}
			fields[name] = string(value)
			continue
		}

		extension := normalizeFormat(filepath.Ext(part.FileName()))
		if extension == "" {
			extension = "upload"
		}
		file, err := os.Create(filepath.Join(tempDir, "upload."+extension))
		if err != nil {
			part.Close()
			return "", nil, fmt.Errorf("create upload file: %w", err)
		}
		if _, err := io.Copy(file, part); err != nil {
			part.Close()
			file.Close()
			if isMaxBytesError(err) {
				return "", nil, fmt.Errorf("%w: limit %d bytes", errUploadTooLarge, maxUploadBytes)
			}
			return "", nil, fmt.Errorf("write upload file: %w", err)
		}
		part.Close()
		if err := file.Close(); err != nil {
			return "", nil, fmt.Errorf("close upload file: %w", err)
		}
		uploadPath = file.Name()
	}
	return uploadPath, fields, nil
}

func isMaxBytesError(err error) bool {
	var maxBytesErr *http.MaxBytesError
	return errors.As(err, &maxBytesErr)
}

func fillResultFormats(result Result, sourceFormat string, targetFormat string) Result {
	if result.SourceFormat == "" {
		result.SourceFormat = normalizeFormat(sourceFormat)
	}
	if result.TargetFormat == "" {
		result.TargetFormat = normalizeFormat(targetFormat)
	}
	return result
}

func responseFromResult(result Result, errorMessage string, output []byte) conversionHTTPResponse {
	result = markResultFidelity(result)
	contentType := result.ContentType
	if contentType == "" {
		contentType = contentTypeForFormat(result.TargetFormat)
	}
	if errorMessage == "" {
		errorMessage = result.ErrorMessage
	}
	format := normalizeFormat(result.TargetFormat)
	return conversionHTTPResponse{
		OK:           result.OK,
		Format:       format,
		TargetFormat: format,
		SourceFormat: normalizeFormat(result.SourceFormat),
		Backend:      result.Backend,
		Fidelity:     result.Fidelity,
		ContentType:  contentType,
		Base64:       base64.StdEncoding.EncodeToString(output),
		Warnings:     result.Warnings,
		ErrorCode:    result.ErrorCode,
		ErrorMessage: errorMessage,
		Metrics:      result.Metrics,
	}
}

func writeJSON(response http.ResponseWriter, status int, payload conversionHTTPResponse) {
	setPreviewHeaders(response.Header(), payload)
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(payload)
}

func setPreviewHeaders(headers http.Header, payload conversionHTTPResponse) {
	headers.Set("X-Preview-OK", fmt.Sprintf("%t", payload.OK))
	if payload.Format != "" {
		headers.Set("X-Preview-Format", sanitizeHeaderValue(payload.Format))
	}
	if payload.SourceFormat != "" {
		headers.Set("X-Preview-Source-Format", sanitizeHeaderValue(payload.SourceFormat))
	}
	if payload.TargetFormat != "" {
		headers.Set("X-Preview-Target-Format", sanitizeHeaderValue(payload.TargetFormat))
	}
	if payload.Backend != "" {
		headers.Set("X-Preview-Backend", sanitizeHeaderValue(payload.Backend))
	}
	if payload.Fidelity != "" {
		headers.Set("X-Preview-Fidelity", sanitizeHeaderValue(payload.Fidelity))
	}
	if payload.ErrorCode != "" {
		headers.Set("X-Preview-Error-Code", sanitizeHeaderValue(payload.ErrorCode))
	}
	if payload.ErrorMessage != "" {
		headers.Set("X-Preview-Error-Message", sanitizeHeaderValue(payload.ErrorMessage))
	}
}

func sanitizeHeaderValue(value string) string {
	return strings.Join(strings.Fields(strings.ReplaceAll(value, "\x00", "")), " ")
}

func contentTypeForFormat(format string) string {
	switch normalizeFormat(format) {
	case "pptx":
		return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
	case "docx":
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	case "xlsx":
		return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	default:
		return "application/octet-stream"
	}
}
