package converter

import (
	"bytes"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/IceWhaleTech/filens/wasm/converter-core/manifest"
)

func TestBackendChainOptionsCapabilitiesDescribeBackendsInOrder(t *testing.T) {
	report := BackendChainOptions{}.Capabilities(true)

	if !report.OK {
		t.Fatalf("expected healthy capabilities: %+v", report)
	}
	if !report.RequiresWASM || !report.WasmConfigured {
		t.Fatalf("unexpected wasm flags: %+v", report)
	}
	if len(report.Backends) != 1 {
		t.Fatalf("unexpected backend count: %d", len(report.Backends))
	}
	if report.Backends[0].Name != "wasi" || report.Backends[0].Kind != "wasi" || report.Backends[0].Fidelity != ConversionFidelityWASI || !report.Backends[0].RequiresWASM {
		t.Fatalf("unexpected WASI capabilities: %+v", report.Backends[0])
	}
	if !reflect.DeepEqual(report.SupportedConversions, manifest.SupportedConversions()) {
		t.Fatalf("capabilities drifted from WASM core manifest:\ngot:  %+v\nwant: %+v", report.SupportedConversions, manifest.SupportedConversions())
	}
}

func TestBackendChainOptionsCapabilitiesReportMissingWASM(t *testing.T) {
	report := BackendChainOptions{}.Capabilities(false)

	if report.OK {
		t.Fatalf("expected missing wasm to be unhealthy: %+v", report)
	}
	if !report.RequiresWASM || report.WasmConfigured {
		t.Fatalf("unexpected wasm flags: %+v", report)
	}
	if report.ErrorCode != ErrorCodeEngineUnavailable || report.ErrorMessage != "wasm path is not configured" {
		t.Fatalf("unexpected missing wasm error: %+v", report)
	}
	if len(report.Backends) != 1 || report.Backends[0].Name != "wasi" {
		t.Fatalf("unexpected backends: %+v", report.Backends)
	}
}

func TestBackendChainOptionsCapabilitiesReportNoBackends(t *testing.T) {
	report := BackendChainOptions{DisableWASIBackend: true}.Capabilities(false)

	if report.OK {
		t.Fatalf("expected no-backend report to be unhealthy: %+v", report)
	}
	if report.ErrorCode != ErrorCodeEngineUnavailable || report.ErrorMessage != "no converter backends configured" {
		t.Fatalf("unexpected no-backend error: %+v", report)
	}
	if len(report.Backends) != 0 {
		t.Fatalf("expected no backends, got %+v", report.Backends)
	}
}

func TestRunCapabilitiesWritesJSON(t *testing.T) {
	var stdout bytes.Buffer
	report, err := RunCapabilities(CapabilitiesConfig{
		BackendChain: BackendChainOptions{
			DisableWASIBackend: false,
		},
		WasmPath: "converter-core.wasm",
		Stdout:   &stdout,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !report.OK {
		t.Fatalf("expected capabilities to be ok: %+v", report)
	}
	if stdout.Len() == 0 {
		t.Fatal("expected capabilities JSON")
	}

	var payload ConverterCapabilities
	if err := json.Unmarshal(stdout.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if !payload.OK ||
		len(payload.Backends) != 1 ||
		payload.Backends[0].Name != "wasi" {
		t.Fatalf("unexpected capabilities payload: %+v", payload)
	}
}

func hasCapabilityPair(pairs []ConversionPair, sourceFormat string, targetFormat string) bool {
	for _, pair := range pairs {
		if pair.SourceFormat == sourceFormat && pair.TargetFormat == targetFormat {
			return true
		}
	}
	return false
}
