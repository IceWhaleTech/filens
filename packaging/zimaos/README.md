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

The homepage, bundled samples (including camera RAW), and locally imported files
work without NAS authentication. The demo does not read host tokens, request
`/v3/file`, or redirect to a host login page.

External audio, video, and proprietary panorama samples load on demand through
public `/external-samples/` proxy routes. To use these examples on a ZimaOS
gateway, configure equivalent proxies to those in `apps/demo/vite.config.ts`
or `vercel.json`. Vite development/preview and `scripts/serve-static.py` already
provide them. External originals are not included in the extension image;
their source links and usage terms are listed in
`apps/demo/public/samples/SOURCES.md`.
