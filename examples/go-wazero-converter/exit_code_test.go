package converter

import "testing"

func TestExitCodeFromResult(t *testing.T) {
	cases := []struct {
		name   string
		result Result
		want   int
	}{
		{name: "ok", result: Result{OK: true}, want: 0},
		{name: "unsupported", result: Result{ErrorCode: ErrorCodeUnsupportedFormat}, want: ExitCodeUnsupportedFormat},
		{name: "password required", result: Result{ErrorCode: ErrorCodePasswordRequired}, want: ExitCodePasswordRequired},
		{name: "password invalid", result: Result{ErrorCode: ErrorCodePasswordInvalid}, want: ExitCodePasswordInvalid},
		{name: "parse", result: Result{ErrorCode: ErrorCodeParse}, want: ExitCodeParseError},
		{name: "conversion", result: Result{ErrorCode: ErrorCodeConversionFailed}, want: ExitCodeConversionFailed},
		{name: "io", result: Result{ErrorCode: ErrorCodeIO}, want: ExitCodeIOError},
		{name: "engine", result: Result{ErrorCode: ErrorCodeEngineUnavailable}, want: ExitCodeEngineUnavailable},
		{name: "fallback exit code", result: Result{ExitCode: 9}, want: 9},
		{name: "unknown fallback", result: Result{}, want: ExitCodeUsage},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			got := ExitCodeFromResult(testCase.result)
			if got != testCase.want {
				t.Fatalf("expected %d, got %d", testCase.want, got)
			}
		})
	}
}

func TestExitCodeFromReport(t *testing.T) {
	report := BatchReport{
		OK: false,
		Results: []BatchJobResult{
			{Result: Result{OK: true}},
			{Result: Result{ErrorCode: ErrorCodeEngineUnavailable}},
			{Result: Result{ErrorCode: ErrorCodeUnsupportedFormat}},
		},
	}

	if got := ExitCodeFromReport(report); got != ExitCodeEngineUnavailable {
		t.Fatalf("expected %d, got %d", ExitCodeEngineUnavailable, got)
	}

	if got := ExitCodeFromReport(BatchReport{OK: true}); got != 0 {
		t.Fatalf("expected 0, got %d", got)
	}
}

func TestExitCodeFromCapabilities(t *testing.T) {
	if got := ExitCodeFromCapabilities(ConverterCapabilities{OK: true}); got != 0 {
		t.Fatalf("expected 0, got %d", got)
	}
	if got := ExitCodeFromCapabilities(ConverterCapabilities{ErrorCode: ErrorCodeEngineUnavailable}); got != ExitCodeEngineUnavailable {
		t.Fatalf("expected %d, got %d", ExitCodeEngineUnavailable, got)
	}
	if got := ExitCodeFromCapabilities(ConverterCapabilities{}); got != ExitCodeUsage {
		t.Fatalf("expected %d, got %d", ExitCodeUsage, got)
	}
}
