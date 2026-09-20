package converter

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHTTPHandlerReturnsJSONConversionResult(t *testing.T) {
	handler := NewHTTPHandler(HTTPHandlerOptions{
		WasmPath: "converter-core.wasm",
		Convert: func(
			_ context.Context,
			wasmPath string,
			inputPath string,
			outputPath string,
			sourceFormat string,
			targetFormat string,
			opts Options,
		) (Result, error) {
			if wasmPath != "converter-core.wasm" {
				t.Fatalf("unexpected wasm path: %s", wasmPath)
			}
			if sourceFormat != "doc" || targetFormat != "docx" {
				t.Fatalf("unexpected formats: %s -> %s", sourceFormat, targetFormat)
			}
			if opts.Password != "secret" || opts.Locale != "en-US" {
				t.Fatalf("unexpected options: %+v", opts)
			}
			bytes, err := os.ReadFile(inputPath)
			if err != nil {
				t.Fatal(err)
			}
			if string(bytes) != "legacy document" {
				t.Fatalf("unexpected upload bytes: %q", string(bytes))
			}
			writeMinimalOpenXMLForValidation(t, outputPath, targetFormat)
			return Result{
				OK:           true,
				SourceFormat: sourceFormat,
				TargetFormat: targetFormat,
				Backend:      "test",
				Fidelity:     "test-fidelity",
				ContentType:  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				Warnings:     []string{"Converted by test."},
				Metrics:      Metrics{ElapsedMs: 7, InputSize: int64(len(bytes))},
				OutputPath:   outputPath,
			}, nil
		},
	})

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, multipartRequest(t, map[string]string{
		"sourceFormat": "doc",
		"targetFormat": "docx",
		"name":         "legacy.doc",
		"password":     "secret",
		"locale":       "en-US",
	}, "file", "legacy.doc", []byte("legacy document")))

	if response.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d\n%s", response.Code, response.Body.String())
	}
	if response.Header().Get("X-Preview-OK") != "true" {
		t.Fatalf("unexpected ok header: %s", response.Header().Get("X-Preview-OK"))
	}
	if response.Header().Get("X-Preview-Format") != "docx" {
		t.Fatalf("unexpected format header: %s", response.Header().Get("X-Preview-Format"))
	}
	if response.Header().Get("X-Preview-Source-Format") != "doc" {
		t.Fatalf("unexpected source header: %s", response.Header().Get("X-Preview-Source-Format"))
	}
	if response.Header().Get("X-Preview-Target-Format") != "docx" {
		t.Fatalf("unexpected target header: %s", response.Header().Get("X-Preview-Target-Format"))
	}
	if response.Header().Get("X-Preview-Backend") != "test" {
		t.Fatalf("unexpected backend header: %s", response.Header().Get("X-Preview-Backend"))
	}
	if response.Header().Get("X-Preview-Fidelity") != "test-fidelity" {
		t.Fatalf("unexpected fidelity header: %s", response.Header().Get("X-Preview-Fidelity"))
	}

	var payload conversionHTTPResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if !payload.OK {
		t.Fatal("expected ok response")
	}
	if payload.Format != "docx" || payload.TargetFormat != "docx" || payload.SourceFormat != "doc" {
		t.Fatalf("unexpected formats: %+v", payload)
	}
	if payload.ContentType != "application/vnd.openxmlformats-officedocument.wordprocessingml.document" {
		t.Fatalf("unexpected content type: %s", payload.ContentType)
	}
	if payload.Backend != "test" {
		t.Fatalf("unexpected backend: %s", payload.Backend)
	}
	if payload.Fidelity != "test-fidelity" {
		t.Fatalf("unexpected fidelity: %s", payload.Fidelity)
	}
	decoded, err := base64.StdEncoding.DecodeString(payload.Base64)
	if err != nil {
		t.Fatal(err)
	}
	if len(decoded) < 4 || string(decoded[:2]) != "PK" {
		t.Fatalf("unexpected converted bytes: %q", string(decoded[:min(8, len(decoded))]))
	}
	if len(payload.Warnings) != 1 || payload.Warnings[0] != "Converted by test." {
		t.Fatalf("unexpected warnings: %+v", payload.Warnings)
	}
	if payload.Metrics.InputSize == 0 {
		t.Fatal("expected input size metric")
	}
}

func TestHTTPHandlerValidatesSuccessfulOpenXMLOutput(t *testing.T) {
	handler := NewHTTPHandler(HTTPHandlerOptions{
		WasmPath: "converter-core.wasm",
		Convert: func(
			_ context.Context,
			_ string,
			_ string,
			outputPath string,
			sourceFormat string,
			targetFormat string,
			_ Options,
		) (Result, error) {
			if err := os.WriteFile(outputPath, []byte("not an OpenXML zip"), 0o644); err != nil {
				t.Fatal(err)
			}
			return Result{
				OK:           true,
				SourceFormat: sourceFormat,
				TargetFormat: targetFormat,
				Backend:      "test",
				Fidelity:     "test-fidelity",
			}, nil
		},
	})

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, multipartRequest(t, map[string]string{
		"sourceFormat": "doc",
		"targetFormat": "docx",
	}, "file", "legacy.doc", []byte("legacy document")))

	if response.Code != http.StatusBadGateway {
		t.Fatalf("unexpected status: %d\n%s", response.Code, response.Body.String())
	}
	if response.Header().Get("X-Preview-Error-Code") != ErrorCodeConversionFailed {
		t.Fatalf("unexpected error code header: %s", response.Header().Get("X-Preview-Error-Code"))
	}

	var payload conversionHTTPResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.OK || payload.ErrorCode != ErrorCodeConversionFailed {
		t.Fatalf("unexpected payload: %+v", payload)
	}
	if payload.Base64 != "" {
		t.Fatal("expected no converted payload for invalid OpenXML output")
	}
}

func TestHTTPHandlerMapsEngineUnavailable(t *testing.T) {
	handler := NewHTTPHandler(HTTPHandlerOptions{
		WasmPath: "converter-core.wasm",
		Convert: func(
			_ context.Context,
			_ string,
			_ string,
			_ string,
			sourceFormat string,
			targetFormat string,
			_ Options,
		) (Result, error) {
			return Result{
				OK:           false,
				SourceFormat: sourceFormat,
				TargetFormat: targetFormat,
				ContentType:  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
				Warnings:     []string{"Production-fidelity pure WASI conversion engine is not bundled."},
				ErrorCode:    "engine_unavailable",
				ErrorMessage: "No production-fidelity pure WASI conversion engine\nis available for this build.",
			}, nil
		},
	})

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, multipartRequest(t, map[string]string{
		"sourceFormat": "ppt",
		"targetFormat": "pptx",
	}, "file", "legacy.ppt", []byte("legacy presentation")))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("unexpected status: %d\n%s", response.Code, response.Body.String())
	}
	if response.Header().Get("X-Preview-OK") != "false" {
		t.Fatalf("unexpected ok header: %s", response.Header().Get("X-Preview-OK"))
	}
	if response.Header().Get("X-Preview-Error-Code") != "engine_unavailable" {
		t.Fatalf("unexpected error code header: %s", response.Header().Get("X-Preview-Error-Code"))
	}
	if response.Header().Get("X-Preview-Error-Message") != "No production-fidelity pure WASI conversion engine is available for this build." {
		t.Fatalf("unexpected error message header: %q", response.Header().Get("X-Preview-Error-Message"))
	}
	var payload conversionHTTPResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.OK {
		t.Fatal("expected failed response")
	}
	if payload.ErrorCode != "engine_unavailable" {
		t.Fatalf("unexpected error code: %s", payload.ErrorCode)
	}
	if payload.Format != "pptx" || payload.TargetFormat != "pptx" || payload.SourceFormat != "ppt" {
		t.Fatalf("unexpected formats: %+v", payload)
	}
	if payload.Base64 != "" {
		t.Fatal("expected no converted payload on failure")
	}
}

func TestHTTPHandlerRejectsUnsupportedConversionPairBeforeWASI(t *testing.T) {
	handler := NewHTTPHandler(HTTPHandlerOptions{})

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, multipartRequest(t, map[string]string{
		"sourceFormat": "webp",
		"targetFormat": "png",
	}, "file", "image.webp", []byte("image bytes")))

	if response.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("unexpected status: %d\n%s", response.Code, response.Body.String())
	}
	if response.Header().Get("X-Preview-OK") != "false" {
		t.Fatalf("unexpected ok header: %s", response.Header().Get("X-Preview-OK"))
	}
	if response.Header().Get("X-Preview-Error-Code") != ErrorCodeUnsupportedFormat {
		t.Fatalf("unexpected error code header: %s", response.Header().Get("X-Preview-Error-Code"))
	}

	var payload conversionHTTPResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.OK {
		t.Fatal("expected failed response")
	}
	if payload.ErrorCode != ErrorCodeUnsupportedFormat {
		t.Fatalf("unexpected error code: %+v", payload)
	}
	if payload.SourceFormat != "webp" || payload.TargetFormat != "png" || payload.Format != "png" {
		t.Fatalf("unexpected formats: %+v", payload)
	}
	if payload.Base64 != "" {
		t.Fatal("expected no converted payload on unsupported response")
	}
}

func TestHTTPHandlerRequiresWASMForSupportedConversionPairs(t *testing.T) {
	handler := NewHTTPHandler(HTTPHandlerOptions{})

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, multipartRequest(t, map[string]string{
		"sourceFormat": "doc",
		"targetFormat": "docx",
	}, "file", "legacy.doc", []byte("legacy document")))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("unexpected status: %d\n%s", response.Code, response.Body.String())
	}
	if response.Header().Get("X-Preview-Error-Code") != ErrorCodeEngineUnavailable {
		t.Fatalf("unexpected error code header: %s", response.Header().Get("X-Preview-Error-Code"))
	}

	var payload conversionHTTPResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.OK || payload.ErrorCode != ErrorCodeEngineUnavailable {
		t.Fatalf("unexpected payload: %+v", payload)
	}
	if payload.SourceFormat != "doc" || payload.TargetFormat != "docx" || payload.Format != "docx" {
		t.Fatalf("unexpected formats: %+v", payload)
	}
}

func TestHTTPHandlerSurfacesWASIPasswordErrors(t *testing.T) {
	handler := NewHTTPHandler(HTTPHandlerOptions{
		WasmPath: buildConverterCoreWASM(t),
	})

	testCases := []struct {
		name      string
		password  string
		errorCode string
	}{
		{name: "missing password", errorCode: ErrorCodePasswordRequired},
		{name: "invalid password", password: "secret", errorCode: ErrorCodePasswordInvalid},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			fields := map[string]string{
				"sourceFormat": "doc",
				"targetFormat": "docx",
				"name":         "encrypted.doc",
			}
			if testCase.password != "" {
				fields["password"] = testCase.password
			}

			response := httptest.NewRecorder()
			handler.ServeHTTP(response, multipartRequest(t, fields, "file", "encrypted.doc", buildEncryptedCompoundFileForTest()))

			if response.Code != http.StatusUnauthorized {
				t.Fatalf("unexpected status: %d\n%s", response.Code, response.Body.String())
			}
			if response.Header().Get("X-Preview-Error-Code") != testCase.errorCode {
				t.Fatalf("unexpected error code header: %s", response.Header().Get("X-Preview-Error-Code"))
			}

			var payload conversionHTTPResponse
			if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
				t.Fatal(err)
			}
			if payload.OK || payload.ErrorCode != testCase.errorCode {
				t.Fatalf("unexpected payload: %+v", payload)
			}
			if payload.SourceFormat != "doc" || payload.TargetFormat != "docx" || payload.Format != "docx" {
				t.Fatalf("unexpected formats: %+v", payload)
			}
			if payload.Backend != "wasi" || payload.Fidelity != ConversionFidelityLightweight {
				t.Fatalf("unexpected backend metadata: %+v", payload)
			}
			if payload.Base64 != "" {
				t.Fatal("expected no converted payload for password error")
			}
		})
	}
}

func TestHTTPHandlerUsesWASIConverterCore(t *testing.T) {
	exampleRoot := filepath.Join(findRepoRoot(t), "examples", "go-wazero-converter")
	bytes, err := os.ReadFile(filepath.Join(exampleRoot, "fixtures", "doc", "sample.wps"))
	if err != nil {
		t.Fatal(err)
	}

	handler := NewHTTPHandler(HTTPHandlerOptions{
		WasmPath: buildConverterCoreWASM(t),
	})

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, multipartRequest(t, map[string]string{
		"sourceFormat": "wps",
		"targetFormat": "docx",
		"name":         "sample.wps",
	}, "file", "sample.wps", bytes))

	if response.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d\n%s", response.Code, response.Body.String())
	}
	var payload conversionHTTPResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if !payload.OK || payload.Format != "docx" || payload.SourceFormat != "wps" {
		t.Fatalf("unexpected payload: %+v", payload)
	}
	if payload.Backend != "wasi" || response.Header().Get("X-Preview-Backend") != "wasi" {
		t.Fatalf("unexpected backend metadata: payload=%q header=%q", payload.Backend, response.Header().Get("X-Preview-Backend"))
	}
	if payload.Fidelity != ConversionFidelityLightweight || response.Header().Get("X-Preview-Fidelity") != ConversionFidelityLightweight {
		t.Fatalf("unexpected fidelity metadata: payload=%q header=%q", payload.Fidelity, response.Header().Get("X-Preview-Fidelity"))
	}
	if payload.Base64 == "" {
		t.Fatal("expected converted fixture payload")
	}
}

func TestHTTPHandlerRejectsBadRequests(t *testing.T) {
	handler := NewHTTPHandler(HTTPHandlerOptions{WasmPath: "converter-core.wasm"})

	methodResponse := httptest.NewRecorder()
	handler.ServeHTTP(methodResponse, httptest.NewRequest(http.MethodGet, "/convert", nil))
	if methodResponse.Code != http.StatusMethodNotAllowed {
		t.Fatalf("unexpected method status: %d", methodResponse.Code)
	}

	missingFileResponse := httptest.NewRecorder()
	handler.ServeHTTP(missingFileResponse, multipartRequest(t, map[string]string{
		"sourceFormat": "doc",
		"targetFormat": "docx",
	}, "", "", nil))
	if missingFileResponse.Code != http.StatusBadRequest {
		t.Fatalf("unexpected missing file status: %d", missingFileResponse.Code)
	}

	missingFormatResponse := httptest.NewRecorder()
	handler.ServeHTTP(missingFormatResponse, multipartRequest(t, map[string]string{
		"targetFormat": "docx",
	}, "file", "README", []byte("legacy document")))
	if missingFormatResponse.Code != http.StatusBadRequest {
		t.Fatalf("unexpected missing format status: %d", missingFormatResponse.Code)
	}
}

func TestHTTPHandlerRejectsUploadsOverConfiguredLimit(t *testing.T) {
	called := false
	handler := NewHTTPHandler(HTTPHandlerOptions{
		WasmPath:       "converter-core.wasm",
		MaxUploadBytes: 256,
		Convert: func(
			_ context.Context,
			_ string,
			_ string,
			_ string,
			_ string,
			_ string,
			_ Options,
		) (Result, error) {
			called = true
			return Result{}, nil
		},
	})

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, multipartRequest(t, map[string]string{
		"sourceFormat": "doc",
		"targetFormat": "docx",
	}, "file", "large.doc", bytes.Repeat([]byte("x"), 2048)))

	if called {
		t.Fatal("converter should not be called when upload exceeds max size")
	}
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("unexpected status: %d\n%s", response.Code, response.Body.String())
	}
	if response.Header().Get("X-Preview-Error-Code") != ErrorCodeIO {
		t.Fatalf("unexpected error code header: %s", response.Header().Get("X-Preview-Error-Code"))
	}

	var payload conversionHTTPResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.OK || payload.ErrorCode != ErrorCodeIO {
		t.Fatalf("unexpected payload: %+v", payload)
	}
	if !strings.Contains(payload.ErrorMessage, "upload exceeds configured maximum size") {
		t.Fatalf("unexpected error message: %q", payload.ErrorMessage)
	}
}

func multipartRequest(
	t *testing.T,
	fields map[string]string,
	fileField string,
	fileName string,
	fileBytes []byte,
) *http.Request {
	t.Helper()

	body := new(bytes.Buffer)
	writer := multipart.NewWriter(body)
	for key, value := range fields {
		if err := writer.WriteField(key, value); err != nil {
			t.Fatal(err)
		}
	}
	if fileField != "" {
		part, err := writer.CreateFormFile(fileField, filepath.Base(fileName))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(fileBytes); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/convert", body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	return request
}
