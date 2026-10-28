package converter

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// These fixtures were written by actual applications, independently of FiLens.
// The controlled-container regression matrix remains useful for edge cases.
func TestRealApplicationCorpus(t *testing.T) {
	data, err := os.ReadFile("testdata/application/manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Format, Input, SHA256     string
		Keywords, OrderedKeywords []string
		External                  bool
	}
	if err = json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	e := testExtractor(t)
	// Native OCR keyword correctness is checked by Search's offline worker suite.
	e.config.OCR = ocrFunc(func(context.Context, string) (string, error) { return "Request body APPLICATION_IMAGE_OCR", nil })
	for _, c := range cases {
		t.Run(c.Input, func(t *testing.T) {
			path := filepath.Join("testdata/application", c.Input)
			if c.External {
				directory := os.Getenv("FILENS_APPLICATION_CORPUS")
				if directory == "" {
					t.Skip("set FILENS_APPLICATION_CORPUS to the prepared official WPS fixtures; see testdata/application/README.md")
				}
				path = filepath.Join(directory, c.Input)
			}
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			sum := sha256.Sum256(data)
			if hex.EncodeToString(sum[:]) != c.SHA256 {
				t.Fatal("application fixture SHA256 mismatch")
			}
			if strings.TrimPrefix(filepath.Ext(path), ".") != c.Format {
				t.Fatal("fixture extension does not match provenance")
			}
			r, err := e.ExtractText(context.Background(), path, Options{})
			if err != nil || !r.Complete || r.Truncated {
				t.Fatalf("%+v: %v", r, err)
			}
			for _, word := range c.Keywords {
				if !strings.Contains(r.Text, word) {
					t.Errorf("keyword %q missing in %.500s", word, r.Text)
				}
			}
			remaining := r.Text
			for _, word := range c.OrderedKeywords {
				i := strings.Index(remaining, word)
				if i < 0 {
					t.Fatalf("keyword order lost at %q: %.500s", word, r.Text)
				}
				remaining = remaining[i+len(word):]
			}
		})
	}
}
