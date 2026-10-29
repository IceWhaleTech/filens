package converter

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestAgentTextCapabilitiesAndEvidence(t *testing.T) {
	e := testExtractor(t)
	formats, err := e.Capabilities(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, f := range formats {
		if seen[f.Format] {
			t.Fatalf("duplicate format %s", f.Format)
		}
		seen[f.Format] = true
	}
	for _, f := range []string{"txt", "md", "html", "docx", "pdf", "pages", "xlsx", "csv", "json", "png"} {
		if !seen[f] {
			t.Errorf("missing format %s", f)
		}
	}
	text := "中文证据\n" + strings.Repeat("long line ", 4000) + "\n" + strings.Repeat("paragraph\n\n", 2100) + "FINAL_MARKER"
	p := filepath.Join(t.TempDir(), "report.txt")
	if err := os.WriteFile(p, []byte(text), 0600); err != nil {
		t.Fatal(err)
	}
	r, err := e.ExtractText(context.Background(), p, Options{IncludeStructure: true})
	if err != nil || r.Text != text || r.Document == nil || r.Truncated {
		t.Fatalf("result bytes=%d: %v", len(r.Text), err)
	}
	cursor := 0
	for _, b := range r.Document.Blocks {
		if b.StartByte != cursor || !utf8.ValidString(r.Text[b.StartByte:b.EndByte]) {
			t.Fatalf("invalid evidence span %+v", b)
		}
		cursor = b.EndByte
	}
	if cursor != len(text) || r.Document.Bytes != len(text) || r.Document.Characters != utf8.RuneCountInString(text) {
		t.Fatalf("invalid document stats %+v", r.Document)
	}
	r, err = e.ExtractText(context.Background(), p, Options{MaxBytes: 4, IncludeStructure: true})
	if err != nil || !r.Truncated || r.Text != "中" || r.Document.Bytes != 3 {
		t.Fatalf("%+v %v", r, err)
	}
}

func TestAgentTabularTextUsesCoreParsers(t *testing.T) {
	e := testExtractor(t)
	for ext, text := range map[string]string{"csv": "Name,Amount\n中文,42", "json": `[{"Name":"中文","Amount":42}]`} {
		p := filepath.Join(t.TempDir(), "data."+ext)
		if err := os.WriteFile(p, []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
		r, err := e.ExtractText(context.Background(), p, Options{IncludeStructure: true})
		if err != nil || !strings.Contains(r.Text, "中文") || !strings.Contains(r.Text, "42") {
			t.Fatalf("%s: %+v %v", ext, r, err)
		}
	}
}
