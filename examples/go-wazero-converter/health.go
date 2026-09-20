package converter

import (
	"encoding/json"
	"fmt"
	"net/http"
)

type HealthHandlerOptions struct {
	WasmPath     string
	BackendChain BackendChainOptions
}

type healthHandler struct {
	capabilities ConverterCapabilities
}

func NewHealthHandler(options HealthHandlerOptions) http.Handler {
	return &healthHandler{
		capabilities: options.BackendChain.Capabilities(options.WasmPath != ""),
	}
}

func (handler *healthHandler) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		payload := handler.capabilities
		payload.OK = false
		payload.ErrorCode = ErrorCodeIO
		payload.ErrorMessage = "method not allowed"
		response.Header().Set("Allow", "GET, HEAD")
		writeCapabilityJSON(response, http.StatusMethodNotAllowed, payload, request.Method == http.MethodHead)
		return
	}

	status := http.StatusOK
	if !handler.capabilities.OK {
		status = http.StatusServiceUnavailable
	}
	writeCapabilityJSON(response, status, handler.capabilities, request.Method == http.MethodHead)
}

func writeCapabilityJSON(response http.ResponseWriter, status int, payload ConverterCapabilities, headOnly bool) {
	response.Header().Set("Content-Type", "application/json")
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("X-Preview-OK", fmt.Sprintf("%t", payload.OK))
	response.Header().Set("X-Preview-Requires-WASM", fmt.Sprintf("%t", payload.RequiresWASM))
	response.WriteHeader(status)
	if headOnly {
		return
	}
	_ = json.NewEncoder(response).Encode(payload)
}
