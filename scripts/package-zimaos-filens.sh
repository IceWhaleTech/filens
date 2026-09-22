#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dist_dir="${1:-${repo_root}/apps/demo/dist}"
output_path="${2:-${repo_root}/dist/filens.raw}"
stage_dir="$(mktemp -d)"
trap 'rm -rf "${stage_dir}"' EXIT

module_dir="${stage_dir}/usr/share/casaos/www/modules/filens"
mkdir -p "${module_dir}" \
  "${stage_dir}/usr/share/casaos/modules" \
  "${stage_dir}/usr/lib/extension-release.d"

cp -a "${dist_dir}/." "${module_dir}/"
cp "${repo_root}/packaging/zimaos/filens.json" "${stage_dir}/usr/share/casaos/modules/filens.json"
cp "${repo_root}/packaging/zimaos/icon.svg" "${module_dir}/icon.svg"
printf 'ID=_any\n' > "${stage_dir}/usr/lib/extension-release.d/extension-release.filens"

mkdir -p "$(dirname "${output_path}")"
mksquashfs "${stage_dir}" "${output_path}" -noappend -no-xattrs -comp zstd -all-root >/dev/null
printf 'Created %s (%s)\n' "${output_path}" "$(du -h "${output_path}" | cut -f1)"
