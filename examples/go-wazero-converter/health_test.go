package converter

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthHandlerReturnsCapabilities(t *testing.T) {
	handler := NewHealthHandler(HealthHandlerOptions{
		WasmPath: "converter-core.wasm",
	})

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d\n%s", response.Code, response.Body.String())
	}
	if response.Header().Get("X-Preview-OK") != "true" {
		t.Fatalf("unexpected ok header: %s", response.Header().Get("X-Preview-OK"))
	}
	if response.Header().Get("X-Preview-Requires-WASM") != "true" {
		t.Fatalf("unexpected wasm header: %s", response.Header().Get("X-Preview-Requires-WASM"))
	}

	var payload ConverterCapabilities
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if !payload.OK || !payload.RequiresWASM || !payload.WasmConfigured {
		t.Fatalf("unexpected health payload: %+v", payload)
	}
	if len(payload.Backends) != 1 || payload.Backends[0].Name != "wasi" {
		t.Fatalf("unexpected backend payload: %+v", payload.Backends)
	}
	if !hasCapabilityPair(payload.SupportedConversions, "wps", "docx") {
		t.Fatalf("missing supported conversion in payload: %+v", payload.SupportedConversions)
	}
}

func TestHealthHandlerReturnsUnavailableWhenWASMIsRequired(t *testing.T) {
	handler := NewHealthHandler(HealthHandlerOptions{})

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("unexpected status: %d\n%s", response.Code, response.Body.String())
	}
	var payload ConverterCapabilities
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.OK || payload.ErrorCode != ErrorCodeEngineUnavailable {
		t.Fatalf("unexpected payload: %+v", payload)
	}
}

func TestHealthHandlerRejectsUnsupportedMethod(t *testing.T) {
	handler := NewHealthHandler(HealthHandlerOptions{
		WasmPath: "converter-core.wasm",
	})

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/healthz", nil))

	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("unexpected status: %d\n%s", response.Code, response.Body.String())
	}
	if response.Header().Get("Allow") != "GET, HEAD" {
		t.Fatalf("unexpected allow header: %s", response.Header().Get("Allow"))
	}
	var payload ConverterCapabilities
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.OK || payload.ErrorMessage != "method not allowed" {
		t.Fatalf("unexpected method payload: %+v", payload)
	}
}
