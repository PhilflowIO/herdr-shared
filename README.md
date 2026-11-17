# herdr-shared

The one source for the scripts that themed Herdr mods run. A theme repo keeps a committed copy
of the files it uses (a `vendored` copy) because a gallery install copies only the mod folder,
and `tools/vendor.sh` writes those copies. Never hand-edit a vendored copy: edit it here.

## What lives here

```
bin/                    runtime files the installed mods link to
  cca                   Claude Code accounts: list, use, add, share, codex
  usage-tap.sh          status-line hook that records the account's rate limits
  usage-api.mjs         reads the Fable and whole-week rows from the usage endpoint
  codex-usage.mjs       reads Codex's rollout logs and auth.json
  models.mjs            the custom-models file (list, add, pane detection)
  scan.sh               the session scanner (see below)
  hv                    open files in the editor mod beside the terminal
  hv-open               the Herdr Open applet's launcher
tools/
  merge-keys.py         add a layout's key zones without changing the person's bindings
  herdr-open/           the single Herdr Open applet builder
  vendor.sh             copy a group into a theme repo, or every pair in its herdr-shared.list
  check-vendor.sh       compare a theme's copies with this repo
  sync-themes.sh        pin, copy, check and test every theme, then commit
  install.sh            copy bin/ into the shared home
  link-installed.sh     link an installed mod folder's files to the shared home
tests/                  node:test suites for everything above (`npm test`)
```

`cca`, `usage-api.mjs`, `codex-usage.mjs` and `models.mjs` must stay in one folder: `cca` finds
its siblings next to itself.

## Groups

`vendor.sh` moves these groups:

| group | files | source |
|---|---|---|
| `accounts` | `cca`, `usage-tap.sh`, `usage-api.mjs`, `codex-usage.mjs`, `models.mjs` | `bin/` |
| `scan` | `scan.sh` | `bin/` |
| `editor` | `hv`, `hv-open` | `bin/` |
| `merge-keys` | `merge-keys.py` | `tools/` |
| `herdr-open` | `build.sh`, `open.applescript`, `set-default.swift` | `tools/herdr-open/` |

## vendor.sh

```sh
tools/vendor.sh <group> <target-dir> [<group> <target-dir>]...
tools/vendor.sh --list <theme-root>
```

Copies the group's files into the target, keeping the exec bit, and prints each file it wrote.
`--list` does the same for every pair in `<theme-root>/herdr-shared.list`. Examples:

```sh
tools/vendor.sh accounts mods/arcade-accounts scan mods/arcade-cards editor mods/arcade-editor
tools/vendor.sh herdr-open tools/herdr-open merge-keys tools
```

An unknown group or a missing source file fails without writing anything for that group. With
`--list`, an unknown group or a missing list exits 2.

## Using it from a theme

A theme takes this repo as a submodule and keeps real copies of the files it uses:

```sh
git submodule add https://github.com/lcalmsky/herdr-shared.git vendor/herdr-shared
```

Write `herdr-shared.list` in the theme root — one `<group> <target-dir>` pair per line, `#`
comments and blank lines ignored:

```
accounts mods/<mod>-accounts
scan     mods/<mod>-cards
```

Then write and check the copies from the pinned submodule:

```sh
vendor/herdr-shared/tools/vendor.sh --list .
vendor/herdr-shared/tools/check-vendor.sh .
```

`check-vendor.sh` compares each listed file with the submodule byte for byte and by the exec bit,
names every file that drifted, and exits 1. On a clean theme it prints
`check-vendor: N files match herdr-shared <short sha>`.

The mod folders hold real files, not symlinks into the submodule, because a herdr.dev gallery
install copies a mod folder from GitHub as it stands: a link and a submodule directory do not
survive that copy. The submodule is the source; the committed copies are what people install.

### Maintainer flow

Edit here, then:

```sh
npm test
git commit -am "..." && git push
tools/sync-themes.sh --commit --push
```

`sync-themes.sh` reads `themes.list` (one `<repo-dir-name> <test command...>` per line, each dir
under `${HERDR_THEMES_ROOT:-<parent of this repo>}`). For each theme it pins
`vendor/herdr-shared` to this repo's HEAD, runs the theme's `vendor.sh --list .` and
`check-vendor.sh`, runs the theme's test command, and commits the submodule pointer and the
copies with `chore: herdr-shared <short sha> 반영`. Before touching anything it refuses when
this repo is dirty or its HEAD is not on an upstream branch, or when a theme is missing, has no
`herdr-shared.list`, has no submodule, or has uncommitted changes to tracked files (untracked
files are allowed and never added). `--commit` alone leaves the commits local; `--push` (which
requires `--commit`) pushes only themes that have an `origin` remote.

## install.sh

```sh
./tools/install.sh
```

Copies `bin/*` into `${HERDR_SHARED_HOME:-$HOME/.local/share/herdr-shared}`, replacing that
folder whole and keeping the modes. Run it after any change to `bin/`.

## link-installed.sh

```sh
tools/link-installed.sh <installed-mod-dir>...
```

For each installed mod folder, replaces every file whose name also exists in the shared home
with a symlink to it, prints what it linked, and leaves everything else (the mod's own `main.js`,
`mod.json`, assets) as it is. A theme's `tools/install.sh` calls this after copying its mods.
When the shared home does not exist, nothing is linked and the installed copies stay, so a
public install without herdr-shared still works.

## herdr-open

```sh
tools/herdr-open/build.sh --mod <editor-mod-id> [--restore]
```

Builds `~/Applications/Herdr Open.app` (bundle id `dev.herdr.open`) and makes it the default app
for code files. The applet calls
`${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/<mod>/hv-open` with the mod id written in at
build time, so one app serves whichever editor mod was installed. `--restore` puts back the
apps recorded before the build. There is only one default app per extension, so run this for the
theme whose editor should receive files.

## merge-keys.py

```sh
python3 tools/merge-keys.py <keys.json> <layout keys file> --backup-tag <tag>
```

Adds the layout's zones to `keys.json` and leaves bindings the person already has untouched
(it prints them). Writes atomically, and writes a backup `keys.json.bak-<tag>-<timestamp>`
only when it actually adds something. A symlinked `keys.json` is written through to its target.

## scan.sh

`bin/scan.sh` is the one session scanner used by every Herdr mod. Run with `sh bin/scan.sh`; it prints one JSON object per line — a `{"t":"s"}` record per live Claude Code, Codex or Gemini CLI session, then a single `{"t":"meta"}` record. Each session carries its activity summary, background work, deadhd checklist, page alerts, terminal location, `account` and git `repo`, plus an `identity` whose `thread` names the thread-memory topic it started from.

Two optional readers — the thread memory and the per-ticket goals file — are off unless configured. Their paths come from, in order, the environment (`HERDR_THREAD_SESSIONS`, `HERDR_GOALS_FILE`) and then
`${XDG_CONFIG_HOME:-$HOME/.config}/herdr-shared/scan.json`:

```json
{
  "threadSessions": "~/.claude/state/<app>/sessions",
  "goalsFile": "~/.claude/state/<app>/active-programs.json"
}
```

`threadSessions` is the folder holding one folder per thread session and switches on the `identity.thread` topic; `goalsFile` is a JSON file with a `programs` array and switches on `meta.objectives`. A `~` at the start expands to `HOME`. A missing, unreadable or malformed config file counts as no config, and an unset path leaves that reader off — no file is opened for it and its fields are absent. The config is read once per run.

Other environment variables: `CLAUDE_CONFIG_DIR`, `PULSE_PS`/`PULSE_LSOF` (process probes), `DEADHD_STATE_DIR` and `PULSE_PAGES_DIR`. It only reads; the sole writes are ledger and identity caches under `${TMPDIR:-/tmp}/herdr-pulse`. The identity cache is versioned (`identity-v2-<sid>.json`) so files left by older, divergent scanners are never trusted. Run its tests with `node --test tests/scan.test.mjs`.
