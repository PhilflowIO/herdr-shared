#!/bin/sh
# install.sh — put the runtime files in one fixed place, so every theme's mod folder can link to
# them. Replaces the whole folder, so a removed file does not linger.
set -eu

REPO=$(cd "$(dirname "$0")/.." && pwd)
DEST=${HERDR_SHARED_HOME-$HOME/.local/share/herdr-shared}
SRC=${HERDR_SHARED_SRC:-$REPO/bin}

refuse() {
  printf 'install.sh: refusing to install into %s: %s\n' "${DEST:-<empty>}" "$1" >&2
  exit 2
}

[ -n "$DEST" ] || refuse "the path is empty or /"
while :; do
  case $DEST in
    */) DEST=${DEST%/} ;;
    *) break ;;
  esac
done
[ -n "$DEST" ] || refuse "the path is empty or /"
case $DEST in
  /*) ;;
  *) refuse "the path is relative" ;;
esac
[ "$DEST" != "${HOME%/}" ] || refuse "the path is HOME"
[ "${DEST##*/}" = "herdr-shared" ] || refuse "the folder name is not herdr-shared"

PARENT=${DEST%/*}
[ -n "$PARENT" ] || PARENT=/
mkdir -p "$PARENT" 2>/dev/null || {
  printf 'install.sh: cannot create %s\n' "$PARENT" >&2
  exit 1
}

NEW=$(mktemp -d "${DEST}.tmp.XXXXXX") || {
  printf 'install.sh: cannot create a temporary folder beside %s\n' "$DEST" >&2
  exit 1
}
trap 'rm -rf "$NEW"' EXIT

cp -p "$SRC"/* "$NEW"/ || {
  printf 'install.sh: copy from %s failed\n' "$SRC" >&2
  exit 1
}
chmod 755 "$NEW"

OLD=
if [ -e "$DEST" ] || [ -L "$DEST" ]; then
  OLD=$(mktemp -d "${DEST}.old.XXXXXX") || exit 1
  rmdir "$OLD"
  mv "$DEST" "$OLD" || {
    printf 'install.sh: cannot move %s aside\n' "$DEST" >&2
    exit 1
  }
fi
if ! mv "$NEW" "$DEST"; then
  [ -z "$OLD" ] || mv "$OLD" "$DEST"
  printf 'install.sh: cannot put the new %s in place\n' "$DEST" >&2
  exit 1
fi
[ -z "$OLD" ] || rm -rf "$OLD"

printf 'installed %s\n' "$DEST"
