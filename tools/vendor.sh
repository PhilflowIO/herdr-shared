#!/bin/sh
# vendor.sh <group> <target-dir> [<group> <target-dir>]... — copy a group's runtime files into a
# theme repo, keeping the exec bit. The theme repos commit these copies so a gallery install of
# one mod folder is self-contained.
set -eu

REPO=$(cd "$(dirname "$0")/.." && pwd)

usage() {
  printf 'usage: vendor.sh <group> <target-dir> [<group> <target-dir>]...\n' >&2
  printf 'groups: accounts scan editor merge-keys herdr-open\n' >&2
  exit 2
}

[ $# -ge 2 ] || usage
[ $(( $# % 2 )) -eq 0 ] || usage

while [ $# -gt 0 ]; do
  group=$1
  target=$2
  shift 2
  case $group in
    accounts) from=$REPO/bin; files="cca usage-tap.sh usage-api.mjs codex-usage.mjs models.mjs" ;;
    scan) from=$REPO/bin; files="scan.sh" ;;
    editor) from=$REPO/bin; files="hv hv-open" ;;
    merge-keys) from=$REPO/tools; files="merge-keys.py" ;;
    herdr-open) from=$REPO/tools/herdr-open; files="build.sh open.applescript set-default.swift" ;;
    *) printf 'vendor.sh: unknown group %s\n' "$group" >&2; usage ;;
  esac
  for name in $files; do
    if [ ! -f "$from/$name" ]; then
      printf 'vendor.sh: missing %s for group %s\n' "$from/$name" "$group" >&2
      exit 1
    fi
  done
  mkdir -p "$target"
  for name in $files; do
    cp -p "$from/$name" "$target/$name"
    printf '%s\n' "$target/$name"
  done
done
