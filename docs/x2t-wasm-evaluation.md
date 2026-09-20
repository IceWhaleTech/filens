# ONLYOFFICE x2t WASM Candidate Evaluation

This note tracks how to evaluate `cryptpad/onlyoffice-x2t-wasm` without widening this repository's default conversion boundary or adding backend conversion logic.

## Current Decision

Keep the existing `wasm/converter-core` as the default conversion core:

- It is a pure WASI CLI module with path-based IO.
- It can be invoked directly from Go through wazero.
- It shares one narrow conversion manifest with TypeScript preview routes and the Go wrapper.
- It returns stable error codes and validates successful OpenXML outputs.

Treat `cryptpad/onlyoffice-x2t-wasm` as an optional high-fidelity browser-side candidate only. It should not replace the WASI/wazero path unless a future build can run as pure WASI without JavaScript glue.

## Why They Are Different

| Area | This Repository | `cryptpad/onlyoffice-x2t-wasm` |
| --- | --- | --- |
| Runtime shape | WASI CLI entry point mounted at `/work` | Emscripten-style browser bundle |
| Go backend fit | Native wazero path-IO wrapper | Not directly usable by wazero unless a WASI build exists |
| Conversion scope | Manifest-backed document, text/source, and table-like inputs to OpenXML | Broader ONLYOFFICE x2t conversion surface |
| Fidelity target | Lightweight structured extraction for preview/indexing | Candidate for higher-fidelity Office conversion |
| Default policy | Manifest-gated OpenXML normalization only; PNG-only standalone image route | Must be wrapped and filtered to this repository's manifest before use |

References:

- `cryptpad/onlyoffice-x2t-wasm`: https://github.com/cryptpad/onlyoffice-x2t-wasm
- CryptPad installation docs describe x2t as needed for document conversions and installed from the `onlyoffice-x2t-wasm` releases: https://docs.cryptpad.org/en/admin_guide/installation.html
- wazero documentation: https://wazero.io/docs/

## Non-Negotiable Gates

Any x2t-based integration must pass these gates before it can be advertised as supported:

1. **Boundary gate**: requests are filtered to `wasm/converter-core/manifest/conversions.json`; iWork, CAD, media, archive, ebook, diagram, image, and non-manifest macro-capable conversion routes are not added by default.
2. **Runtime gate**: Go backend paths remain thin shells around pure WASI only. Emscripten JS glue is acceptable only in a front-end adapter or an explicitly separate host, not in `examples/go-wazero-converter`.
3. **Fixture gate**: the existing converter fixture manifest must convert successfully and pass OpenXML validation.
4. **Content gate**: converted outputs must contain real extracted content for content-bearing fixtures; placeholder or synthetic success text is a failure.
5. **Macro gate**: macro-enabled OpenXML inputs may be normalized only if macro content types, macro relationships, and `vbaProject.bin` parts are stripped; converted outputs containing macros are rejected.
6. **Error gate**: failures map to the existing stable error codes: `unsupported_format`, `password_required`, `password_invalid`, `parse_error`, `conversion_failed`, `io_error`, `engine_unavailable`.
7. **Operational gate**: report artifact size, memory behavior, startup time, browser compatibility, and license obligations before enabling by default anywhere.

## Local Audit

After checking out or extracting a candidate bundle locally, run:

```sh
npm run audit:x2t-candidate -- --candidate ../onlyoffice-x2t-wasm
```

or point at a release artifact directory:

```sh
npm run audit:x2t-candidate -- --candidate ./tmp/x2t-release
```

The audit writes:

- `tmp/x2t-candidate-audit/report.json`
- `tmp/x2t-candidate-audit/report.md`

The audit script has a local self-test with synthetic candidate bundles:

```sh
npm run test:audit-x2t-candidate
```

The audit is intentionally static. It does not execute third-party code. It checks whether the candidate looks like a WASI module, an Emscripten browser bundle, or neither, then records whether it can be considered for the Go/wazero path.

By default the command writes a report and exits successfully so it can be used during exploration. Add `--strict` when using it as a gate:

```sh
npm run audit:x2t-candidate -- --candidate ../onlyoffice-x2t-wasm --strict
```

## Interpretation

- `wazeroEligible=true`: the candidate exposes a WASI `_start` style module and can be considered for a backend wrapper spike.
- `browserAdapterCandidate=true`: the candidate appears to use JavaScript/Emscripten glue and should only be considered for a front-end adapter spike.
- `blocked`: do not integrate yet; write down the missing gate and keep using the current WASI core.

## Next Valid Step

The next valid implementation step is a separate experimental adapter, not a default route change:

- `packages/converter-client` may add an opt-in x2t browser adapter after a candidate passes static audit and fixture execution smoke.
- `examples/go-wazero-converter` must remain WASI-only.
- The shared manifest remains the source of truth for default conversion pairs.
