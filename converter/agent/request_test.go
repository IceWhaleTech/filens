package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNaturalLanguageAndStructuredRequests(t *testing.T) {
	for _, tc := range []struct {
		name                     string
		args                     []string
		stdin                    string
		operation, input, format string
	}{
		{"Chinese capacity", []string{"你能做什么？以 JSON 输出"}, "", "capabilities", "", "json"},
		{"English capacity", []string{"what can you do as json"}, "", "capabilities", "", "json"},
		{"capacity with natural output", []string{"capacity as json"}, "", "capabilities", "", "json"},
		{"Chinese read", []string{`请读取 "季度 报告.pdf"，以纯文本输出`}, "", "read", "季度 报告.pdf", "text"},
		{"English understand", []string{`understand "meeting notes.docx" as json`}, "", "understand", "meeting notes.docx", "json"},
		{"Chinese understand", []string{`帮我理解“会议纪要.pages”，用JSON返回`}, "", "understand", "会议纪要.pages", "json"},
		{"optional command", []string{"read", "report.pdf", "--json"}, "", "read", "report.pdf", "json"},
		{"structured stdin", []string{"-"}, `{"operation":"understand","input":"report.pdf"}`, "understand", "report.pdf", "json"},
		{"natural stdin", []string{"-"}, `读取 "report.pdf"，以 JSON 输出`, "read", "report.pdf", "json"},
		{"explicit format wins", []string{`read "report.pdf" as json`, "--format=text"}, "", "read", "report.pdf", "text"},
		{"explicit input", []string{"--input", "report.pdf", "--json"}, "", "read", "report.pdf", "json"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			o, err := parseCLI(tc.args, strings.NewReader(tc.stdin))
			if err != nil {
				t.Fatal(err)
			}
			if o.Operation != tc.operation || o.Input != tc.input || o.Format != tc.format {
				t.Fatalf("%+v", o.Request)
			}
		})
	}
}

func TestRejectAmbiguousAndUnsupportedRequests(t *testing.T) {
	for _, tc := range []struct {
		args  []string
		stdin string
	}{
		{[]string{`read "one.pdf" and "two.docx"`}, ""},
		{[]string{`summarize "report.pdf" as json`}, ""},
		{[]string{"--input", "https://example.com/report.pdf"}, ""},
		{[]string{"read", "report.pdf", "--format", "toml"}, ""},
		{[]string{"--max-bytes", "-1"}, ""},
		{[]string{"--max-bytes", "33554433"}, ""},
		{[]string{"--timeout", "0s"}, ""},
		{[]string{"--input"}, ""},
		{[]string{"-"}, `{"input":"r.pdf","unknown":true}`},
		{[]string{"-"}, `{"input":"r.pdf"} {}`},
		{[]string{"-"}, ""},
		{[]string{"-"}, strings.Repeat("x", (1<<20)+1)},
	} {
		if _, err := parseCLI(tc.args, strings.NewReader(tc.stdin)); err == nil {
			t.Fatalf("accepted %+v", tc.args)
		}
	}
}

func TestShellArgumentPreservesPathAndTreatsItAsData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "report $(whoami) 中文.txt")
	if err := os.WriteFile(path, []byte("text"), 0600); err != nil {
		t.Fatal(err)
	}
	o, err := parseCLI([]string{"read", path, "--json"}, strings.NewReader(""))
	if err != nil || o.Input != path {
		t.Fatalf("%+v %v", o, err)
	}
	if _, err := parseCLI([]string{"read", path, "missing.pdf"}, strings.NewReader("")); err == nil {
		t.Fatal("ignored a missing second input")
	}
}

func TestJSONErrorsDoNotContaminateStdout(t *testing.T) {
	for _, tc := range []struct {
		args      []string
		input     string
		code      int
		errorCode string
	}{
		{[]string{"--json", "--unknown"}, "", 2, "invalid_request"},
		{[]string{"--unknown", "--json"}, "", 2, "invalid_request"},
		{[]string{"-"}, `{"input":`, 2, "invalid_request"},
		{[]string{"-"}, `{"format":"toml","input":"report.pdf"}`, 2, "invalid_request"},
		{[]string{"read", "does-not-exist.pdf", "--json"}, "", 1, "io_error"},
	} {
		var stdout, stderr bytes.Buffer
		code := Run(context.Background(), tc.args, strings.NewReader(tc.input), &stdout, &stderr)
		var r Response
		if err := json.Unmarshal(stdout.Bytes(), &r); err != nil {
			t.Fatalf("invalid stdout %q: %v", stdout.String(), err)
		}
		if code != tc.code || r.OK || r.Error == nil || r.Error.Code != tc.errorCode {
			t.Fatalf("code=%d response=%+v", code, r)
		}
		if stderr.Len() != 0 {
			t.Fatalf("unexpected diagnostics: %s", stderr.String())
		}
	}
}
