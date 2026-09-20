module github.com/IceWhaleTech/filens/examples/go-wazero-converter

go 1.24.0

require github.com/tetratelabs/wazero v1.11.0

require golang.org/x/sys v0.38.0 // indirect

require github.com/IceWhaleTech/filens/wasm/converter-core v0.0.0

replace github.com/IceWhaleTech/filens/wasm/converter-core => ../../wasm/converter-core
