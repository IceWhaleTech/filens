package converter

import (
	"os"
	"path/filepath"
	"testing"
)

func buildConverterCoreWASM(t *testing.T) string {
	t.Helper()
	wasmPath := filepath.Join(findRepoRoot(t), "wasm", "converter-core", "dist", "converter-core.wasm")
	if _, err := os.Stat(wasmPath); err != nil {
		t.Fatalf("find converter wasm: %v; run npm run build:wasm first", err)
	}
	return wasmPath
}
