package converter

import (
	_ "embed"
	"encoding/json"
)

//go:embed text-formats.json
var textFormats []byte

type Capability struct {
	Format         string `json:"format"`
	Kind           string `json:"kind"`
	TextExtraction bool   `json:"textExtraction"`
	OCR            bool   `json:"ocr"`
}

// TextCapabilities is independent of the preview conversion-pair manifest.
// OCR indicates that the route can request an injected OCR provider.
func TextCapabilities() []Capability {
	var wire struct {
		Capabilities []Capability `json:"capabilities"`
	}
	if err := json.Unmarshal(textFormats, &wire); err != nil {
		panic(err)
	}
	return wire.Capabilities
}
