#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
packages_dir="${1:-${repo_root}/dist/npm}"
output_path="${2:-${repo_root}/dist/filens.raw}"
version="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).cliVersion" "${repo_root}/packaging/zimaos/release.json")"
package_version="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).version" "${repo_root}/packaging/zimaos/release.json")"
stage_dir="$(mktemp -d)"
trap 'rm -rf "${stage_dir}"' EXIT

mkdir -p "${stage_dir}/usr/bin" "${stage_dir}/usr/lib/filens" \
  "${stage_dir}/usr/share/casaos/modules" "${stage_dir}/usr/lib/extension-release.d"

for platform in linux-x64 linux-arm64; do
  archive="${packages_dir}/filens-cli-${platform}-${version}.tgz"
  if [[ ! -f "${archive}" ]]; then
    printf 'Missing %s; download the published CLI packages or run npm run package:agent:npm first.\n' "${archive}" >&2
    exit 1
  fi
  bundle_dir="${stage_dir}/usr/lib/filens/${platform}"
  mkdir -p "${bundle_dir}"
  tar -xzf "${archive}" -C "${bundle_dir}" --strip-components 1 \
    package/filens package/package.json package/converter-text.wasm.gz \
    package/converter-image.wasm.gz package/pdfium.wasm.gz package/LICENSE \
    package/THIRD-PARTY-NOTICES.md package/licenses
  node -e '
    const fs = require("fs"), path = require("path");
    const [dir, platform, version] = process.argv.slice(1);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    if (pkg.name !== `filens-cli-${platform}` || pkg.version !== version) throw new Error("CLI package identity mismatch");
    const elf = fs.readFileSync(path.join(dir, "filens"));
    const machine = platform === "linux-x64" ? 62 : 183;
    if (elf.subarray(0, 4).toString() !== "\x7fELF" || elf[4] !== 2 || elf[5] !== 1 || elf.readUInt16LE(18) !== machine) throw new Error("CLI binary architecture mismatch");
  ' "${bundle_dir}" "${platform}" "${version}"
  chmod 755 "${bundle_dir}/filens"
  ocr_archive="${packages_dir}/filens-ocr-${platform}-${version}.tgz"
  node -e '
    const fs = require("fs"), crypto = require("crypto");
    const [archive, platform, out] = process.argv.slice(1);
    const sha = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
    fs.appendFileSync(out, `${platform} ${sha} ${require("path").basename(archive)}\n`);
  ' "${ocr_archive}" "${platform}" "${stage_dir}/usr/lib/filens/ocr-packages.sha256"
done

cp "${repo_root}/packaging/zimaos/filens" "${stage_dir}/usr/bin/filens"
cp "${repo_root}/packaging/zimaos/setup-ocr" "${stage_dir}/usr/lib/filens/setup-ocr"
chmod 755 "${stage_dir}/usr/bin/filens"
chmod 755 "${stage_dir}/usr/lib/filens/setup-ocr"
printf '%s\n' "${version}" > "${stage_dir}/usr/lib/filens/cli-version"
node -e '
  const fs = require("fs");
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  manifest.version = process.argv[3];
  fs.writeFileSync(process.argv[2], JSON.stringify(manifest, null, 2) + "\n");
' "${repo_root}/packaging/zimaos/filens.json" "${stage_dir}/usr/share/casaos/modules/filens.json" "${package_version}"
printf 'ID=_any\n' > "${stage_dir}/usr/lib/extension-release.d/extension-release.filens"

mkdir -p "$(dirname "${output_path}")"
mksquashfs "${stage_dir}" "${output_path}" -noappend -no-xattrs -comp zstd -all-root >/dev/null
node -e '
  const fs = require("fs"), crypto = require("crypto"), path = require("path");
  const output = process.argv[1];
  if (fs.statSync(output).size > 15000000) throw new Error("FiLens raw exceeds the 15 MB Mod Store CDN budget");
  const sha = crypto.createHash("sha256").update(fs.readFileSync(output)).digest("hex");
  fs.writeFileSync(`${output}.sha256`, `${sha}  ${path.basename(output)}\n`);
' "${output_path}"
printf 'Created %s (package %s, CLI %s, %s)\n' "${output_path}" "${package_version}" "${version}" "$(du -h "${output_path}" | cut -f1)"
