# Agent Instructions

## Converter Architecture Boundary

- All file parsing and conversion logic must live in the frontend WebAssembly conversion core.
- Backend Go code must only act as a thin shell: CLI/HTTP plumbing, request validation, temporary-file handling, result/error mapping, OpenXML output validation, and invoking the WASM core.
- Do not add new format-specific conversion algorithms to backend wrapper code such as `examples/go-wazero-converter`.
- If existing backend code contains format conversion logic, prefer migrating that logic into the WASM conversion core instead of extending it in place.
- Frontend TypeScript may call the frontend WASM/TS conversion library directly; backend paths should wrap the same conversion core rather than implementing a separate converter.
