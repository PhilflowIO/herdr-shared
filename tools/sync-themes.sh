#!/bin/sh
# sync-themes.sh [--commit] [--push] [theme...] — pin every theme's herdr-shared submodule to this
# repo's HEAD, rewrite the theme's vendored copies from it, check them and run the theme's tests.
set -eu
set -f

REPO=$(cd "$(dirname "$0")/.." && pwd)
THEMES_LIST=${HERDR_THEMES_LIST:-$REPO/themes.list}
THEMES_ROOT=${HERDR_THEMES_ROOT:-$(cd "$REPO/.." && pwd)}

usage() {
  printf 'usage: sync-themes.sh [--commit] [--push] [theme...]\n' >&2
  exit 2
}

fail() {
  printf 'sync-themes.sh: %s\n' "$*" >&2
  exit 1
}

fail_theme() {
  printf 'sync-themes.sh: %s: %s failed; stopping\n' "$1" "$2" >&2
  exit 1
}

commit=no
push=no
requested=
for arg in "$@"; do
  case $arg in
    --commit) commit=yes ;;
    --push) push=yes ;;
    -*) usage ;;
    *) requested="$requested $arg" ;;
  esac
done

[ "$push" = no ] || [ "$commit" = yes ] || {
  printf 'sync-themes.sh: --push requires --commit\n' >&2
  exit 2
}
[ -f "$THEMES_LIST" ] || {
  printf 'sync-themes.sh: missing %s\n' "$THEMES_LIST" >&2
  exit 2
}

registry_names() {
  awk '
    { line=$0; sub(/^[ \t]+/, "", line) }
    line == "" || line ~ /^#/ { next }
    { split(line, field, /[ \t]+/); print field[1] }
  ' "$THEMES_LIST"
}

command_for() {
  awk -v name="$1" '
    { line=$0; sub(/^[ \t]+/, "", line) }
    line == "" || line ~ /^#/ { next }
    {
      split(line, field, /[ \t]+/)
      if (field[1] != name) next
      sub(/^[^ \t]+[ \t]+/, "", line)
      print line
      exit
    }
  ' "$THEMES_LIST"
}

in_registry() {
  registry_names | grep -qx "$1"
}

selected() {
  [ -z "$requested" ] && return 0
  for want in $requested; do
    [ "$want" = "$1" ] && return 0
  done
  return 1
}

for name in $requested; do
  in_registry "$name" || fail "theme $name is not in $THEMES_LIST"
done

names=
for name in $(registry_names); do
  selected "$name" && names="$names $name"
done
[ -n "$names" ] || fail "no theme selected from $THEMES_LIST"

[ -z "$(git -C "$REPO" status --porcelain)" ] \
  || fail "this repo has uncommitted changes; commit them first"

sha=$(git -C "$REPO" rev-parse HEAD)
short=$(git -C "$REPO" rev-parse --short HEAD)
if ! git -C "$REPO" branch -r --contains "$sha" 2>/dev/null | grep -q .; then
  git -C "$REPO" merge-base --is-ancestor "$sha" '@{u}' 2>/dev/null \
    || fail "HEAD $short is not on any upstream branch; push it first"
fi

for name in $names; do
  theme=$THEMES_ROOT/$name
  [ -d "$theme" ] || fail "theme $name not found at $theme"
  [ -f "$theme/herdr-shared.list" ] || fail "theme $name has no herdr-shared.list"
  git -C "$theme" ls-files --stage -- vendor/herdr-shared 2>/dev/null | grep -q '^160000' \
    || fail "theme $name has no vendor/herdr-shared submodule"
  git -C "$theme" config -f .gitmodules --get-regexp '\.path$' 2>/dev/null \
    | grep -q ' vendor/herdr-shared$' \
    || fail "theme $name does not register vendor/herdr-shared in .gitmodules"
  [ -z "$(git -C "$theme" status --porcelain --untracked-files=no)" ] \
    || fail "theme $name has uncommitted changes to tracked files"
done

summary=
for name in $names; do
  theme=$THEMES_ROOT/$name
  sub=$theme/vendor/herdr-shared
  git -C "$theme" submodule update --init vendor/herdr-shared >/dev/null \
    || fail_theme "$name" "git submodule update --init"
  git -C "$sub" fetch --quiet origin \
    || fail_theme "$name" "fetch in vendor/herdr-shared"
  git -C "$sub" checkout --quiet --detach "$sha" \
    || fail_theme "$name" "checkout $short in vendor/herdr-shared"
  # Stage only the files vendor.sh wrote: a target dir can hold unlisted files that must stay untracked.
  vendored=$(sh "$sub/tools/vendor.sh" --list "$theme") \
    || fail_theme "$name" "vendor.sh --list"
  sh "$sub/tools/check-vendor.sh" "$theme" >/dev/null \
    || fail_theme "$name" "check-vendor.sh"
  cmd=$(command_for "$name")
  ( cd "$theme" && sh -c "$cmd" ) \
    || fail_theme "$name" "test command: $cmd"

  set -- vendor/herdr-shared
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    case $line in
      "$theme"/*) set -- "$@" "${line#"$theme"/}" ;;
      *) fail_theme "$name" "vendor.sh wrote $line outside $theme" ;;
    esac
  done <<EOF
$vendored
EOF

  if [ -z "$(git -C "$theme" status --porcelain -- "$@")" ]; then
    printf '%s: already at %s\n' "$name" "$short"
    status=already
  elif [ "$commit" = no ]; then
    status=updated
  else
    git -C "$theme" add -- "$@" || fail_theme "$name" "git add"
    body=$(git -C "$theme" diff --cached --name-only -- "$@" | sed 's/^/- /') \
      || fail_theme "$name" "list changed files"
    message="chore: herdr-shared $short 반영

$body"
    git -C "$theme" commit --quiet -m "$message" || fail_theme "$name" "git commit"
    status=committed
    if [ "$push" = yes ]; then
      if git -C "$theme" remote get-url origin >/dev/null 2>&1; then
        git -C "$theme" push --quiet origin HEAD || fail_theme "$name" "git push"
        status=pushed
      else
        printf '%s: no origin; publish it with its own flow\n' "$name"
        status=no-origin
      fi
    fi
  fi
  summary="$summary$name: $status
"
done

printf '%s' "$summary"
