package converter

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestFormatAcceptanceMatrix(t *testing.T) {
	data, err := os.ReadFile("testdata/formats.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Format, Input, GeneratedBy string
		Keywords                   []string
	}
	if err = json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	declared := map[string]bool{}
	for _, c := range TextCapabilities() {
		if c.Kind != "image" {
			declared[c.Format] = true
		}
	}
	e := testExtractor(t)
	for _, c := range cases {
		if !declared[c.Format] {
			t.Errorf("undeclared or duplicated format %s", c.Format)
		}
		delete(declared, c.Format)
		if c.GeneratedBy != "" {
			continue
		}
		t.Run(c.Format, func(t *testing.T) {
			r, err := e.ExtractText(context.Background(), c.Input, Options{})
			if err != nil {
				t.Fatalf("%.300s: %v", r.Text, err)
			}
			for _, word := range c.Keywords {
				if !strings.Contains(strings.ToLower(r.Text), strings.ToLower(word)) {
					t.Errorf("keyword %q missing in %.300s", word, r.Text)
				}
			}
		})
	}
	for ext := range declared {
		t.Errorf("missing acceptance fixture for %s", ext)
	}
}
