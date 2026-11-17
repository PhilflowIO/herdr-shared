#!/bin/sh
# check-vendor.sh <theme-root> — compare every file in <theme-root>/herdr-shared.list with this
# repo's copy, byte for byte and by the exec bit.
set -eu
set -f

REPO=$(cd "$(dirname "$0")/.." && pwd)
cr=$(printf '\r')

usage() {
  printf 'usage: check-vendor.sh <theme-root>\n' >&2
  exit 2
}

[ $# -eq 1 ] || usage
theme=$1
list=$theme/herdr-shared.list
if [ ! -f "$list" ]; then
  printf 'check-vendor.sh: missing %s\n' "$list" >&2
  exit 2
fi

source_of() {
  case $1 in
    accounts) from=bin; files="cca usage-tap.sh usage-api.mjs codex-usage.mjs models.mjs" ;;
    scan) from=bin; files="scan.sh" ;;
    editor) from=bin; files="hv hv-open" ;;
    merge-keys) from=tools; files="merge-keys.py" ;;
    herdr-open) from=tools/herdr-open; files="build.sh open.applescript set-default.swift" ;;
    *) printf 'check-vendor.sh: unknown group %s\n' "$1" >&2; exit 2 ;;
  esac
}

is_exec() {
  if [ -x "$1" ]; then printf yes; else printf no; fi
}

problems=0
count=0
while IFS= read -r line || [ -n "$line" ]; do
  line=${line%"$cr"}
  line=${line%%#*}
  set -- $line
  [ $# -gt 0 ] || continue
  if [ $# -ne 2 ]; then
    printf 'check-vendor.sh: bad line in %s: %s\n' "$list" "$line" >&2
    exit 2
  fi
  group=$1
  target=$2
  source_of "$group"
  for name in $files; do
    count=$((count + 1))
    src=$REPO/$from/$name
    copy=$theme/$target/$name
    if ! cmp -s "$src" "$copy" 2>/dev/null || [ "$(is_exec "$src")" != "$(is_exec "$copy")" ]; then
      printf '%s\n' "$target/$name differs from $from/$name; run vendor/herdr-shared/tools/vendor.sh --list ."
      problems=$((problems + 1))
    fi
  done
done < "$list"

if [ "$count" -eq 0 ]; then
  printf 'check-vendor.sh: no files listed in %s\n' "$list" >&2
  exit 2
fi

if [ "$problems" -gt 0 ]; then
  exit 1
fi

sha=$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null) || sha=unknown
printf 'check-vendor: %s files match herdr-shared %s\n' "$count" "$sha"
