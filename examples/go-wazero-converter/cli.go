package converter

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

type CLIConfig struct {
	WasmPath     string
	InputPath    string
	OutputPath   string
	SourceFormat string
	TargetFormat string
	OptionsPath  string
	Options      Options
	ResultPath   string
	BackendChain BackendChainOptions
	Convert      ConverterFunc
	Stdout       io.Writer
	Stderr       io.Writer
}

func RunCLI(ctx context.Context, config CLIConfig) (Result, error) {
	convert := config.Convert
	if convert == nil {
		chain := NewBackendChain(config.BackendChain)
		defer chain.Close(ctx)
		convert = chain.ConverterFunc()
	}
	if config.WasmPath == "" && (config.Convert != nil || config.BackendChain.RequiresWASM()) {
		return Result{}, errors.New("wasm path is required")
	}
	if config.InputPath == "" {
		return Result{}, errors.New("input path is required")
	}
	if config.OutputPath == "" {
		return Result{}, errors.New("output path is required")
	}

	if config.OptionsPath != "" {
		options, err := readOptionsFile(config.OptionsPath)
		if err != nil {
			return Result{}, err
		}
		config.Options = mergeOptions(options, config.Options)
	}

	sourceFormat := normalizeFormat(config.SourceFormat)
	if sourceFormat == "" {
		sourceFormat = normalizeFormat(filepath.Ext(config.InputPath))
	}
	if sourceFormat == "" {
		return Result{}, errors.New("source format is required")
	}
	targetFormat := normalizeFormat(config.TargetFormat)
	if targetFormat == "" {
		targetFormat = normalizeFormat(filepath.Ext(config.OutputPath))
	}
	if targetFormat == "" {
		return Result{}, errors.New("target format is required")
	}

	result, err := convert(ctx, config.WasmPath, config.InputPath, config.OutputPath, sourceFormat, targetFormat, config.Options)
	if err != nil {
		return markResultFidelity(result), err
	}
	result = markResultFidelity(result)

	if config.ResultPath != "" && config.ResultPath != "-" {
		if err := writeResultFile(config.ResultPath, result); err != nil {
			return result, err
		}
	} else if config.Stdout != nil {
		if err := writeResultJSON(config.Stdout, result); err != nil {
			return result, err
		}
	}

	return result, nil
}

func readOptionsFile(path string) (Options, error) {
	bytes, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Options{}, nil
		}
		return Options{}, fmt.Errorf("read options: %w", err)
	}
	if len(bytes) == 0 {
		return Options{}, nil
	}
	var options Options
	if err := json.Unmarshal(bytes, &options); err != nil {
		return Options{}, fmt.Errorf("parse options: %w", err)
	}
	return options, nil
}

func writeResultFile(path string, result Result) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create result directory: %w", err)
	}
	file, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("create result file: %w", err)
	}
	defer file.Close()
	if err := writeResultJSON(file, result); err != nil {
		return fmt.Errorf("write result file: %w", err)
	}
	return nil
}

func writeResultJSON(writer io.Writer, result Result) error {
	result = markResultFidelity(result)
	encoder := json.NewEncoder(writer)
	encoder.SetIndent("", "  ")
	return encoder.Encode(result)
}

func mergeOptions(base Options, overrides Options) Options {
	if overrides.Password != "" {
		base.Password = overrides.Password
	}
	if overrides.Locale != "" {
		base.Locale = overrides.Locale
	}
	return base
}
