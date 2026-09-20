package converter

import (
	"net/http"
	"testing"
)

func TestHTTPStatusFromResult(t *testing.T) {
	cases := []struct {
		name   string
		result Result
		want   int
	}{
		{name: "ok", result: Result{OK: true}, want: http.StatusOK},
		{name: "unsupported", result: Result{ErrorCode: ErrorCodeUnsupportedFormat}, want: http.StatusUnsupportedMediaType},
		{name: "password required", result: Result{ErrorCode: ErrorCodePasswordRequired}, want: http.StatusUnauthorized},
		{name: "password invalid", result: Result{ErrorCode: ErrorCodePasswordInvalid}, want: http.StatusUnauthorized},
		{name: "parse", result: Result{ErrorCode: ErrorCodeParse}, want: http.StatusUnprocessableEntity},
		{name: "conversion failed", result: Result{ErrorCode: ErrorCodeConversionFailed}, want: http.StatusBadGateway},
		{name: "io", result: Result{ErrorCode: ErrorCodeIO}, want: http.StatusInternalServerError},
		{name: "engine", result: Result{ErrorCode: ErrorCodeEngineUnavailable}, want: http.StatusServiceUnavailable},
		{name: "fallback", result: Result{}, want: http.StatusInternalServerError},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := HTTPStatusFromResult(testCase.result); got != testCase.want {
				t.Fatalf("expected %d, got %d", testCase.want, got)
			}
		})
	}
}
