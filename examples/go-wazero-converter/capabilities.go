package converter

import (
	"encoding/json"
	"fmt"
	"io"

	"github.com/IceWhaleTech/filens/wasm/converter-core/manifest"
)

type ConversionPair = manifest.ConversionPair

type BackendCapability struct {
	Name                 string           `json:"name"`
	Order                int              `json:"order"`
	Kind                 string           `json:"kind"`
	Fidelity             string           `json:"fidelity,omitempty"`
	RequiresWASM         bool             `json:"requiresWasm,omitempty"`
	SupportedConversions []ConversionPair `json:"supportedConversions,omitempty"`
	Notes                []string         `json:"notes,omitempty"`
}

type ConverterCapabilities struct {
	OK                   bool                `json:"ok"`
	RequiresWASM         bool                `json:"requiresWasm"`
	WasmConfigured       bool                `json:"wasmConfigured"`
	Backends             []BackendCapability `json:"backends"`
	SupportedConversions []ConversionPair    `json:"supportedConversions"`
	Warnings             []string            `json:"warnings,omitempty"`
	ErrorCode            string              `json:"errorCode,omitempty"`
	ErrorMessage         string              `json:"errorMessage,omitempty"`
}

type CapabilitiesConfig struct {
	WasmPath     string
	BackendChain BackendChainOptions
	Stdout       io.Writer
}

func RunCapabilities(config CapabilitiesConfig) (ConverterCapabilities, error) {
	capabilities := config.BackendChain.Capabilities(config.WasmPath != "")
	if config.Stdout != nil {
		if err := WriteCapabilitiesJSON(config.Stdout, capabilities); err != nil {
			return capabilities, err
		}
	}
	return capabilities, nil
}

func WriteCapabilitiesJSON(writer io.Writer, capabilities ConverterCapabilities) error {
	if writer == nil {
		return fmt.Errorf("capabilities writer is required")
	}
	encoder := json.NewEncoder(writer)
	encoder.SetIndent("", "  ")
	return encoder.Encode(capabilities)
}

func (options BackendChainOptions) Capabilities(wasmConfigured bool) ConverterCapabilities {
	return NewBackendChain(options).Capabilities(wasmConfigured)
}

func (chain OrderedBackendChain) Capabilities(wasmConfigured bool) ConverterCapabilities {
	capabilities := ConverterCapabilities{
		OK:                   true,
		WasmConfigured:       wasmConfigured,
		Backends:             make([]BackendCapability, 0, len(chain.Backends)),
		SupportedConversions: SupportedConversions(),
	}

	for _, backend := range chain.Backends {
		if backend == nil {
			continue
		}
		info := backendCapability(backend, len(capabilities.Backends)+1)
		if info.RequiresWASM {
			capabilities.RequiresWASM = true
		}
		capabilities.Backends = append(capabilities.Backends, info)
	}

	if len(capabilities.Backends) == 0 {
		capabilities.OK = false
		capabilities.ErrorCode = ErrorCodeEngineUnavailable
		capabilities.ErrorMessage = "no converter backends configured"
		return capabilities
	}
	if capabilities.RequiresWASM && !wasmConfigured {
		capabilities.OK = false
		capabilities.ErrorCode = ErrorCodeEngineUnavailable
		capabilities.ErrorMessage = "wasm path is not configured"
		capabilities.Warnings = append(capabilities.Warnings, "WASI backend is enabled but no wasm path is configured.")
	}
	return capabilities
}

func backendCapability(backend ConverterBackend, order int) BackendCapability {
	switch backend.(type) {
	case *WASIBackend:
		return wasiBackendCapability(order)
	default:
		return BackendCapability{
			Name:     backend.Name(),
			Order:    order,
			Kind:     "custom",
			Fidelity: fidelityForBackend(backend.Name()),
			Notes:    []string{"Custom backend capabilities are not introspectable by the Go wrapper."},
		}
	}
}

func wasiBackendCapability(order int) BackendCapability {
	return BackendCapability{
		Name:                 "wasi",
		Order:                order,
		Kind:                 "wasi",
		Fidelity:             ConversionFidelityWASI,
		RequiresWASM:         true,
		SupportedConversions: SupportedConversions(),
		Notes: []string{
			"Runs converter-core.wasm; all conversion and parsing logic lives in the WASM module.",
			"Current converter-core builds report the fidelity of the WASM result, often lightweight for bundled legacy-format smoke coverage.",
		},
	}
}
