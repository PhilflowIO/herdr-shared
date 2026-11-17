#!/bin/sh
# link-installed.sh <installed-mod-dir>... — in each installed mod folder, replace the runtime
# files that also exist in the shared home with links to them. Everything else stays a copy, so
# a person without herdr-shared keeps a working install.
set -eu

SHARED=${HERDR_SHARED_HOME:-$HOME/.local/share/herdr-shared}

# macOS readlink has no -f, so follow the links by hand before taking the real directory.
resolve() {
  path=$1
  hops=0
  while [ -L "$path" ] && [ "$hops" -lt 40 ]; do
    target=$(readlink "$path") || return 1
    case $target in
      /*) path=$target ;;
      *) path=$(dirname "$path")/$target ;;
    esac
    hops=$((hops + 1))
  done
  dir=$(dirname "$path")
  [ -d "$dir" ] || return 1
  printf '%s/%s\n' "$(cd "$dir" && pwd -P)" "${path##*/}"
}

[ $# -ge 1 ] || { printf 'usage: link-installed.sh <installed-mod-dir>...\n' >&2; exit 2; }

status=0
for dir in "$@"; do
  if [ ! -d "$dir" ]; then
    printf 'link-installed.sh: %s is not a folder\n' "$dir" >&2
    status=1
    continue
  fi
  for src in "$SHARED"/*; do
    [ -f "$src" ] || continue
    name=${src##*/}
    [ -e "$dir/$name" ] || continue
    # The shared home itself, or a link already pointing at it: linking again would replace a
    # file with a link to itself.
    src_real=$(resolve "$src") || src_real=
    dir_real=$(resolve "$dir/$name") || dir_real=
    if [ -n "$src_real" ] && [ "$src_real" = "$dir_real" ]; then
      continue
    fi
    ln -sfn "$src" "$dir/$name"
    printf 'linked %s\n' "$dir/$name"
  done
done
exit $status
