package converter

import "testing"

func TestSanitizeHeaderValue(t *testing.T) {
	got := sanitizeHeaderValue(" engine_unavailable\r\nbad: header\x00 value\t")
	want := "engine_unavailable bad: header value"
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}
