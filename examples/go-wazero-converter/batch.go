package converter

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

type BatchJob struct {
	InputPath    string  `json:"inputPath"`
	OutputPath   string  `json:"outputPath"`
	SourceFormat string  `json:"sourceFormat,omitempty"`
	TargetFormat string  `json:"targetFormat,omitempty"`
	Password     string  `json:"password,omitempty"`
	Locale       string  `json:"locale,omitempty"`
	Options      Options `json:"options,omitempty"`
}

type BatchDefaults struct {
	SourceFormat string  `json:"sourceFormat,omitempty"`
	TargetFormat string  `json:"targetFormat,omitempty"`
	Password     string  `json:"password,omitempty"`
	Locale       string  `json:"locale,omitempty"`
	Options      Options `json:"options,omitempty"`
}

type BatchManifest struct {
	Defaults BatchDefaults `json:"defaults,omitempty"`
	Jobs     []BatchJob    `json:"jobs"`
}

type BatchConfig struct {
	WasmPath     string
	Manifest     BatchManifest
	ReportPath   string
	Stdout       io.Writer
	BackendChain BackendChainOptions
	Convert      ConverterFunc
}

type BatchJobResult struct {
	Job    BatchJob `json:"job"`
	Result Result   `json:"result"`
}

type BatchReport struct {
	OK       bool             `json:"ok"`
	WasmPath string           `json:"wasmPath"`
	Summary  BatchSummary     `json:"summary"`
	Results  []BatchJobResult `json:"results"`
}

type BatchSummary struct {
	Total       int            `json:"total"`
	OK          int            `json:"ok"`
	Failed      int            `json:"failed"`
	ByBackend   map[string]int `json:"byBackend,omitempty"`
	ByFidelity  map[string]int `json:"byFidelity,omitempty"`
	ByErrorCode map[string]int `json:"byErrorCode,omitempty"`
}

func RunBatch(ctx context.Context, config BatchConfig) (BatchReport, error) {
	convert := config.Convert
	if convert == nil && config.BackendChain.RequiresWASM() {
		chain := NewBackendChain(config.BackendChain)
		defer chain.Close(ctx)
		convert = chain.ConverterFunc()
	}

	report := BatchReport{
		OK:       true,
		WasmPath: config.WasmPath,
		Summary: BatchSummary{
			ByBackend:   map[string]int{},
			ByFidelity:  map[string]int{},
			ByErrorCode: map[string]int{},
		},
		Results: make([]BatchJobResult, 0, len(config.Manifest.Jobs)),
	}
	for _, job := range config.Manifest.Jobs {
		job = applyBatchDefaults(config.Manifest.Defaults, job)
		result, err := RunCLI(ctx, CLIConfig{
			WasmPath:     config.WasmPath,
			InputPath:    job.InputPath,
			OutputPath:   job.OutputPath,
			SourceFormat: job.SourceFormat,
			TargetFormat: job.TargetFormat,
			Options: mergeOptions(job.Options, Options{
				Password: job.Password,
				Locale:   job.Locale,
			}),
			BackendChain: config.BackendChain,
			Convert:      convert,
		})
		if err != nil {
			return report, err
		}
		if !result.OK {
			report.OK = false
		}
		addBatchSummaryResult(&report.Summary, result)
		report.Results = append(report.Results, BatchJobResult{
			Job:    job,
			Result: result,
		})
	}
	if config.ReportPath != "" && config.ReportPath != "-" {
		if err := writeBatchReportFile(config.ReportPath, report); err != nil {
			return report, err
		}
	} else if config.Stdout != nil {
		if err := writeBatchReportJSON(config.Stdout, report); err != nil {
			return report, err
		}
	}
	return report, nil
}

func addBatchSummaryResult(summary *BatchSummary, result Result) {
	summary.Total++
	if result.OK {
		summary.OK++
	} else {
		summary.Failed++
	}
	if result.Backend != "" {
		if summary.ByBackend == nil {
			summary.ByBackend = map[string]int{}
		}
		summary.ByBackend[result.Backend]++
	}
	if result.Fidelity != "" {
		if summary.ByFidelity == nil {
			summary.ByFidelity = map[string]int{}
		}
		summary.ByFidelity[result.Fidelity]++
	}
	if result.ErrorCode != "" {
		if summary.ByErrorCode == nil {
			summary.ByErrorCode = map[string]int{}
		}
		summary.ByErrorCode[result.ErrorCode]++
	}
}

func ReadBatchManifest(path string) (BatchManifest, error) {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return BatchManifest{}, fmt.Errorf("read manifest: %w", err)
	}
	var manifest BatchManifest
	if err := json.Unmarshal(bytes, &manifest); err != nil {
		return BatchManifest{}, fmt.Errorf("parse manifest: %w", err)
	}
	return manifest, nil
}

func writeBatchReportJSON(writer io.Writer, report BatchReport) error {
	encoder := json.NewEncoder(writer)
	encoder.SetIndent("", "  ")
	return encoder.Encode(report)
}

func writeBatchReportFile(path string, report BatchReport) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create report directory: %w", err)
	}
	file, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("create report file: %w", err)
	}
	defer file.Close()
	if err := writeBatchReportJSON(file, report); err != nil {
		return fmt.Errorf("write report file: %w", err)
	}
	return nil
}

func applyBatchDefaults(defaults BatchDefaults, job BatchJob) BatchJob {
	job.SourceFormat = firstNonEmpty(job.SourceFormat, defaults.SourceFormat)
	job.TargetFormat = firstNonEmpty(job.TargetFormat, defaults.TargetFormat)
	job.Password = firstNonEmpty(job.Password, defaults.Password)
	job.Locale = firstNonEmpty(job.Locale, defaults.Locale)
	job.Options = mergeOptions(defaults.Options, job.Options)
	return job
}

func firstNonEmpty(value string, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}
