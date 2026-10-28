package converter

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type ocrFunc func(context.Context, string) (string, error)

func (f ocrFunc) Recognize(c context.Context, p string) (string, error) { return f(c, p) }
func testExtractor(t *testing.T) *Extractor {
	t.Helper()
	path := os.Getenv("FILENS_TEXT_WASM")
	if path == "" {
		path = "../wasm/converter-core-rust/target/wasm32-wasip1/release/converter-text.wasm"
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("build converter-text WASM before integration tests: %v", err)
	}
	e, err := NewExtractor(context.Background(), Config{WASM: data, Stderr: os.Stderr, OCR: ocrFunc(func(context.Context, string) (string, error) { return "OCR injected 中文", nil })})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = e.Close(context.Background()) })
	return e
}
func TestExtractExistingFormats(t *testing.T) {
	e := testExtractor(t)
	families := map[string][]string{
		"doc": {"doc", "docm", "dot", "dotm", "dotx", "fodt", "odt", "ott", "stw", "sxw", "wps", "wpt", "rtf", "epub", "fb2"},
		"ppt": {"ppt", "pptm", "pps", "ppsm", "ppsx", "pot", "potm", "potx", "dps", "dpt", "fodp", "odp", "otp", "sxi"},
		"xls": {"xls", "xlsm", "xlt", "xltm", "xltx", "et", "ett", "fods", "ods", "ots", "sxc"},
	}
	for family, formats := range families {
		for _, format := range formats {
			t.Run(format, func(t *testing.T) {
				input := filepath.Join("../examples/go-wazero-converter/fixtures", family, "sample."+format)
				result, err := e.ExtractText(context.Background(), input, Options{})
				if err != nil {
					t.Fatalf("%+v: %v", result, err)
				}
				expected := "Fixture"
				if family == "xls" {
					expected = "Name"
				}
				if !strings.Contains(strings.ToLower(result.Text), strings.ToLower(expected)) {
					t.Fatalf("%s content keyword %q missing: %.300s", format, expected, result.Text)
				}
			})
		}
	}
}
func TestIWorkSamples(t *testing.T) {
	e := testExtractor(t)
	for _, format := range []string{"pages", "numbers", "key"} {
		t.Run(format, func(t *testing.T) {
			p := "../packages/iwork/vendor/iwork-converter/testdata/a." + format
			result, err := e.ExtractText(context.Background(), p, Options{})
			if err != nil {
				t.Fatalf("%+v: %v", result, err)
			}
			if strings.TrimSpace(result.Text) == "" {
				t.Fatal("iWork content lost")
			}
			t.Logf("%s: %.300s", format, result.Text)
		})
	}
}
func TestPDFSample(t *testing.T) {
	e := testExtractor(t)
	result, err := e.ExtractText(context.Background(), "../apps/demo/public/samples/filens-cosmic-atlas.pdf", Options{})
	if err != nil {
		t.Fatalf("%+v: %v", result, err)
	}
	if !strings.Contains(strings.ToLower(result.Text), "cosmic") {
		t.Fatalf("PDF text missing: %.300s", result.Text)
	}
}
