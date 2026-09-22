package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	converter "github.com/IceWhaleTech/filens/examples/go-wazero-converter"
)

func main() {
	var config converter.CLIConfig
	flag.StringVar(&config.WasmPath, "wasm", "", "path to a converter WASM module")
	flag.StringVar(&config.InputPath, "input", "", "input file path")
	flag.StringVar(&config.OutputPath, "output", "", "output file path")
	flag.StringVar(&config.SourceFormat, "source", "", "source format")
	flag.StringVar(&config.TargetFormat, "target", "", "target format")
	flag.StringVar(&config.OptionsPath, "options", "", "JSON options file path")
	flag.StringVar(&config.ResultPath, "result", "-", "JSON result file path, or - for stdout")
	capabilitiesOnly := flag.Bool("capabilities", false, "print converter backend capabilities as JSON and exit")
	password := flag.String("password", "", "optional file password override")
	locale := flag.String("locale", "", "optional locale override")
	flag.Parse()

	config.Options = converter.Options{
		Password: *password,
		Locale:   *locale,
	}
	config.Stdout = os.Stdout
	if *capabilitiesOnly {
		capabilities, err := converter.RunCapabilities(converter.CapabilitiesConfig{
			WasmPath:     config.WasmPath,
			BackendChain: config.BackendChain,
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

	result, err := converter.RunCLI(context.Background(), config)
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(converter.ExitCodeFromResult(result))
	}
	if !result.OK {
		os.Exit(converter.ExitCodeFromResult(result))
	}
}
