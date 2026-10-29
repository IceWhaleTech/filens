package converter

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestAgentSummaryUsesSharedCore(t *testing.T) {
	e := testExtractor(t)
	text := "文档中心导航。\n预算不得超过12345.67元。\n今天办公室补充咖啡豆。\n风险：部署前必须完成验证。\n"
	p := filepath.Join(t.TempDir(), "meeting.txt")
	if err := os.WriteFile(p, []byte(text), 0600); err != nil {
		t.Fatal(err)
	}
	r, err := e.ExtractText(context.Background(), p, Options{IncludeStructure: true, Summary: &SummaryOptions{Query: "预算 风险", MaxChars: 80, Ratio: 1}})
	if err != nil || !r.Complete || !strings.Contains(r.Text, "不得超过12345.67元") || strings.Contains(r.Text, "咖啡") {
		t.Fatalf("%+v %v", r, err)
	}
	var summary struct {
		Extractive bool `json:"extractive"`
		Excerpts   []struct {
			StartByte       int `json:"startByte"`
			EndByte         int `json:"endByte"`
			SourceStartByte int `json:"sourceStartByte"`
			SourceEndByte   int `json:"sourceEndByte"`
		} `json:"excerpts"`
	}
	if err := json.Unmarshal(r.Summary, &summary); err != nil {
		t.Fatal(err)
	}
	if !summary.Extractive || len(summary.Excerpts) == 0 {
		t.Fatal("missing WASM summary provenance")
	}
	for _, span := range summary.Excerpts {
		if r.Text[span.StartByte:span.EndByte] != text[span.SourceStartByte:span.SourceEndByte] {
			t.Fatal("summary altered source evidence")
		}
	}
	r, err = e.ExtractText(context.Background(), p, Options{Summary: &SummaryOptions{Ratio: 2}})
	if err == nil || r.ErrorCode != "invalid_request" {
		t.Fatalf("core accepted invalid summary budget: %+v %v", r, err)
	}
}

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
