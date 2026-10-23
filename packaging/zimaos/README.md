# FiLens ZimaOS native extension

The demo is packaged as a `systemd-sysext` SquashFS image. It overlays the
frontend at `/usr/share/casaos/www/modules/filens` and registers the
launcher metadata at `/usr/share/casaos/modules/filens.json`.

Build it after the demo build:

```sh
npm run build --workspace @filens/demo
./scripts/package-zimaos-filens.sh
```

Install the resulting `dist/filens.raw` into `/var/lib/extensions/` and
refresh `systemd-sysext`. The existing ZimaOS gateway serves the page at
`/modules/filens/`, so no application server or additional systemd unit is
needed.

The RAW test assets are intentionally kept outside the extension image. The
demo reads the existing ZimaOS `access_token` from `localStorage` and requests
them through `/v3/file?token=...&files=...`. The sample root defaults to
`/media/filens-samples`. Set `VITE_ZIMA_SAMPLE_ROOT` when building for a host
whose test assets live elsewhere; keep machine-specific paths out of public
screenshots and samples.

The product homepage, bundled samples, and locally imported files are available
without a ZimaOS token. Selecting a sample stored on the host requires a valid
token; if it is missing, the app requests the host login route through its
navigation bridge, falling back to the host's root hash login URL. Protected
files continue to be served through the authenticated `/v3/file` endpoint.
