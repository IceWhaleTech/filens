package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"io"
	"strings"
	"testing"

	"go.yaml.in/yaml/v3"
)

func TestOutputIntentsAndLayout(t *testing.T) {
	for _, tc := range []struct {
		intent, format string
		layout         bool
	}{
		{`read "report.pdf" as markdown`, "markdown", false},
		{`read "report.pdf" and output YAML`, "yaml", false},
		{`读取 "report.pdf"，以 HTML 输出`, "html", false},
		{`提取 "sheet.xlsx"，用 CSV 返回`, "csv", false},
		{`读取 "report.pdf"，以 XML 输出`, "xml", false},
		{`获取 "report.pdf" 的布局`, "json", true},
		{`layout "report.pdf" as yml`, "yaml", true},
		{`读取 "布局.json"`, "text", false},
	} {
		o, err := parseCLI([]string{tc.intent}, strings.NewReader(""))
		if err != nil {
			t.Fatal(err)
		}
		if o.Format != tc.format || o.Layout != tc.layout {
			t.Fatalf("%s: %+v", tc.intent, o.Request)
		}
	}
	o, err := parseCLI([]string{"layout", "report.pdf", "--format=md"}, strings.NewReader(""))
	if err != nil || !o.Layout || o.Format != "markdown" {
		t.Fatalf("%+v %v", o, err)
	}
}

func TestStructuredFormatsPreserveProtocolAndEscapeSource(t *testing.T) {
	for _, format := range []string{"yaml", "xml"} {
		var stdout, stderr bytes.Buffer
		code := Run(context.Background(), []string{"read", "missing-source.pdf", "--format", format}, strings.NewReader(""), &stdout, &stderr)
		if code != 1 || stderr.Len() != 0 {
			t.Fatalf("%s: %d %s", format, code, stderr.String())
		}
		if format == "yaml" {
			var v map[string]any
			if err := yaml.Unmarshal(stdout.Bytes(), &v); err != nil || v["ok"] != false {
				t.Fatalf("%s %v", stdout.String(), err)
			}
		} else {
			d := xml.NewDecoder(&stdout)
			for {
				_, err := d.Token()
				if err == io.EOF {
					break
				}
				if err != nil {
					t.Fatal(err)
				}
			}
		}
	}
	var stdout bytes.Buffer
	response := Response{Version: Protocol, OK: true, Capacity: &Capacity{RequestSchema: json.RawMessage(`{"$ref":"<&\""}`)}}
	if err := writeStructured(&stdout, "xml", response); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(stdout.String(), `name="$ref"`) || !strings.Contains(stdout.String(), "&lt;&amp;") {
		t.Fatal(stdout.String())
	}
}
