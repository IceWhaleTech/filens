package converter

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/tetratelabs/wazero"
)

//go:embed text-formats.json
var textFormats []byte

type Capability struct {
	Format         string `json:"format"`
	Kind           string `json:"kind"`
	TextExtraction bool   `json:"textExtraction"`
	OCR            bool   `json:"ocr"`
}

// Capabilities asks the same WASM core that performs extraction. In addition to
// document/OCR routes it includes the shared core's text and tabular formats.
func (e *Extractor) Capabilities(ctx context.Context) ([]Capability, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	work, err := os.MkdirTemp(e.config.TempDir, "filens-capacity-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(work)
	config := wazero.NewModuleConfig().WithName("").WithArgs("converter-text", "--operation", "text-capabilities", "--result", "/work/result.json").WithFSConfig(wazero.NewFSConfig().WithDirMount(work, "/work")).WithStdout(e.config.Stderr).WithStderr(e.config.Stderr)
	instance, err := e.runtime.InstantiateModule(ctx, e.compiled, config)
	if instance != nil {
		_ = instance.Close(context.Background())
	}
	if err != nil {
		return nil, fmt.Errorf("read WASM capabilities: %w", err)
	}
	data, err := os.ReadFile(filepath.Join(work, "result.json"))
	if err != nil {
		return nil, err
	}
	var wire struct {
		OK      bool         `json:"ok"`
		Payload []Capability `json:"payload"`
	}
	if err = json.Unmarshal(data, &wire); err != nil {
		return nil, err
	}
	if !wire.OK || len(wire.Payload) == 0 {
		return nil, fmt.Errorf("text WASM did not return capabilities; rebuild converter-text.wasm")
	}
	return wire.Payload, nil
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
