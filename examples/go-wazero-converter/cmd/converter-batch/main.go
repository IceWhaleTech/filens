package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	converter "github.com/IceWhaleTech/filens/examples/go-wazero-converter"
)

func main() {
	wasmPath := flag.String("wasm", "", "path to converter-core.wasm")
	manifestPath := flag.String("manifest", "", "path to batch manifest json")
	reportPath := flag.String("report", "-", "path to batch report json, or - for stdout")
	capabilitiesOnly := flag.Bool("capabilities", false, "print converter backend capabilities as JSON and exit")
	flag.Parse()

	backendChain := converter.BackendChainOptions{}
	if *capabilitiesOnly {
		capabilities, err := converter.RunCapabilities(converter.CapabilitiesConfig{
			WasmPath:     *wasmPath,
			BackendChain: backendChain,
			Stdout:       os.Stdout,
		})
		if err != nil {
			fmt.Fprintln(os.Stderr, err.Error())
			os.Exit(converter.ExitCodeUsage)
		}
		if !capabilities.OK {
			os.Exit(converter.ExitCodeFromCapabilities(capabilities))
		}
		return
	}
	if *wasmPath == "" || *manifestPath == "" {
		fmt.Fprintln(os.Stderr, "missing required flags: --manifest and --wasm are required")
		os.Exit(1)
	}

	manifest, err := converter.ReadBatchManifest(*manifestPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}

	report, err := converter.RunBatch(context.Background(), converter.BatchConfig{
		WasmPath:     *wasmPath,
		Manifest:     manifest,
		BackendChain: backendChain,
		ReportPath:   *reportPath,
		Stdout:       os.Stdout,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
	if !report.OK {
		os.Exit(converter.ExitCodeFromReport(report))
	}
}
