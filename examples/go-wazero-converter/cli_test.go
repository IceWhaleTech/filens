package converter

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunCLIWritesResultAndUsesOverrides(t *testing.T) {
	tempDir := t.TempDir()
	optionsPath := filepath.Join(tempDir, "options.json")
	resultPath := filepath.Join(tempDir, "result.json")
	inputPath := filepath.Join(tempDir, "legacy.doc")
	outputPath := filepath.Join(tempDir, "out.docx")

	if err := os.WriteFile(optionsPath, []byte(`{"password":"file-password","locale":"en-US"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(inputPath, []byte("legacy"), 0o644); err != nil {
		t.Fatal(err)
	}

	var captured Options
	result, err := RunCLI(context.Background(), CLIConfig{
		WasmPath:     "converter-core.wasm",
		InputPath:    inputPath,
		OutputPath:   outputPath,
		SourceFormat: "doc",
		TargetFormat: "docx",
		OptionsPath:  optionsPath,
		Options:      Options{Locale: "override-locale"},
		ResultPath:   resultPath,
		Convert: func(
			_ context.Context,
			_ string,
			input string,
			output string,
			sourceFormat string,
			targetFormat string,
			opts Options,
		) (Result, error) {
			captured = opts
			if sourceFormat != "doc" || targetFormat != "docx" {
				t.Fatalf("unexpected formats: %s -> %s", sourceFormat, targetFormat)
			}
			if input != inputPath || output != outputPath {
				t.Fatalf("unexpected paths: %s %s", input, output)
			}
			if err := os.WriteFile(output, []byte("converted"), 0o644); err != nil {
				t.Fatal(err)
			}
			return Result{
				OK:           true,
				SourceFormat: sourceFormat,
				TargetFormat: targetFormat,
				Metrics:      Metrics{ElapsedMs: 1, InputSize: 6},
			}, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.OK {
		t.Fatal("expected successful result")
	}
	if captured.Password != "file-password" || captured.Locale != "override-locale" {
		t.Fatalf("unexpected options merge: %+v", captured)
	}
	bytes, err := os.ReadFile(resultPath)
	if err != nil {
		t.Fatal(err)
	}
	var written Result
	if err := json.Unmarshal(bytes, &written); err != nil {
		t.Fatal(err)
	}
	if !written.OK {
		t.Fatal("expected written result to be ok")
	}
}

func TestRunCLICanWriteJSONToStdout(t *testing.T) {
	tempDir := t.TempDir()
	inputPath := filepath.Join(tempDir, "legacy.doc")
	outputPath := filepath.Join(tempDir, "out.docx")
	if err := os.WriteFile(inputPath, []byte("legacy"), 0o644); err != nil {
		t.Fatal(err)
	}

	var stdout bytes.Buffer
	_, err := RunCLI(context.Background(), CLIConfig{
		WasmPath:   "converter-core.wasm",
		InputPath:  inputPath,
		OutputPath: outputPath,
		Convert: func(_ context.Context, _ string, _ string, _ string, _, _ string, _ Options) (Result, error) {
			return Result{OK: false, ErrorCode: "engine_unavailable", ErrorMessage: "not available"}, nil
		},
		Stdout: &stdout,
	})
	if err != nil {
		t.Fatal(err)
	}
	if stdout.Len() == 0 {
		t.Fatal("expected stdout json")
	}
}

func TestRunCLIValidatesRequiredFormats(t *testing.T) {
	tempDir := t.TempDir()
	inputPath := filepath.Join(tempDir, "README")
	outputPath := filepath.Join(tempDir, "result")
	if err := os.WriteFile(inputPath, []byte("legacy"), 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := RunCLI(context.Background(), CLIConfig{
		WasmPath:   "converter-core.wasm",
		InputPath:  inputPath,
		OutputPath: outputPath,
	})
	if err == nil {
		t.Fatal("expected format validation error")
	}
	if !strings.Contains(err.Error(), "source format is required") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRunCLIUsesStdoutWhenResultPathIsDash(t *testing.T) {
	tempDir := t.TempDir()
	inputPath := filepath.Join(tempDir, "legacy.doc")
	outputPath := filepath.Join(tempDir, "out.docx")
	if err := os.WriteFile(inputPath, []byte("legacy"), 0o644); err != nil {
		t.Fatal(err)
	}

	var stdout bytes.Buffer
	result, err := RunCLI(context.Background(), CLIConfig{
		WasmPath:   "converter-core.wasm",
		InputPath:  inputPath,
		OutputPath: outputPath,
		ResultPath: "-",
		Stdout:     &stdout,
		Convert: func(_ context.Context, _ string, _ string, _ string, _, _ string, _ Options) (Result, error) {
			return Result{OK: false, ErrorCode: "engine_unavailable", ErrorMessage: "not available"}, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.ErrorCode != "engine_unavailable" {
		t.Fatalf("unexpected result: %+v", result)
	}
	if stdout.Len() == 0 {
		t.Fatal("expected stdout json")
	}
}

func TestRunCLIUsesWASIConverterCore(t *testing.T) {
	exampleRoot := filepath.Join(findRepoRoot(t), "examples", "go-wazero-converter")
	outputPath := filepath.Join(t.TempDir(), "sample.docx")
	result, err := RunCLI(context.Background(), CLIConfig{
		WasmPath:     buildConverterCoreWASM(t),
		InputPath:    filepath.Join(exampleRoot, "fixtures", "doc", "sample.wps"),
		OutputPath:   outputPath,
		SourceFormat: "wps",
		TargetFormat: "docx",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.OK || result.Backend != "wasi" || result.Fidelity != ConversionFidelityLightweight {
		t.Fatalf("expected WASM converter result: %+v", result)
	}
	if _, err := os.Stat(outputPath); err != nil {
		t.Fatalf("expected CLI WASM output: %v", err)
	}
}
