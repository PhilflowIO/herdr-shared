#!/bin/sh
# vendor.sh <group> <target-dir> [<group> <target-dir>]... — copy a group's runtime files into a
# theme repo, keeping the exec bit. The theme repos commit these copies so a gallery install of
# one mod folder is self-contained.
# vendor.sh --list <theme-root> — do the same for every pair in <theme-root>/herdr-shared.list.
set -eu
set -f

REPO=$(cd "$(dirname "$0")/.." && pwd)
cr=$(printf '\r')

usage() {
  printf 'usage: vendor.sh <group> <target-dir> [<group> <target-dir>]...\n' >&2
  printf '       vendor.sh --list <theme-root>\n' >&2
  printf 'groups: accounts scan editor merge-keys herdr-open\n' >&2
  exit 2
}

group_source() {
  case $1 in
    accounts) from=$REPO/bin; files="cca usage-tap.sh usage-api.mjs codex-usage.mjs models.mjs" ;;
    scan) from=$REPO/bin; files="scan.sh" ;;
    editor) from=$REPO/bin; files="hv hv-open" ;;
    merge-keys) from=$REPO/tools; files="merge-keys.py" ;;
    herdr-open) from=$REPO/tools/herdr-open; files="build.sh open.applescript set-default.swift" ;;
    *) printf 'vendor.sh: unknown group %s\n' "$1" >&2; usage ;;
  esac
}

copy_group() {
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
}

list_line() {
  line=${line%"$cr"}
  line=${line%%#*}
  set -- $line
  [ $# -gt 0 ] || return 1
  if [ $# -ne 2 ]; then
    printf 'vendor.sh: bad line in %s: %s\n' "$list" "$line" >&2
    exit 2
  fi
  group=$1
  target=$2
  return 0
}

if [ "${1-}" = "--list" ]; then
  [ $# -eq 2 ] || usage
  theme=$2
  list=$theme/herdr-shared.list
  if [ ! -f "$list" ]; then
    printf 'vendor.sh: missing %s\n' "$list" >&2
    exit 2
  fi
  # Reject an unknown group before writing anything.
  pairs=0
  while IFS= read -r line || [ -n "$line" ]; do
    list_line || continue
    group_source "$group" >/dev/null
    pairs=$((pairs + 1))
  done < "$list"
  if [ "$pairs" -eq 0 ]; then
    printf 'vendor.sh: no entries in %s\n' "$list" >&2
    exit 2
  fi
  while IFS= read -r line || [ -n "$line" ]; do
    list_line || continue
    target=$theme/$target
    group_source "$group"
    copy_group
  done < "$list"
  exit 0
fi

[ $# -ge 2 ] || usage
[ $(( $# % 2 )) -eq 0 ] || usage

while [ $# -gt 0 ]; do
  group=$1
  target=$2
  shift 2
  group_source "$group"
  copy_group
done
