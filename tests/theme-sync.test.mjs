import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const VENDOR = join(ROOT, "tools/vendor.sh");
const CHECK = join(ROOT, "tools/check-vendor.sh");
const BIN = join(ROOT, "bin");

const LIST = "accounts mods/theme-accounts\nscan mods/theme-scan\n";
const ACCOUNTS = ["cca", "usage-tap.sh", "usage-api.mjs", "codex-usage.mjs", "models.mjs"];

const GIT_ENV = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "protocol.file.allow",
  GIT_CONFIG_VALUE_0: "always",
  GIT_TERMINAL_PROMPT: "0",
};

const temp = (prefix) => mkdtempSync(join(tmpdir(), prefix));
const mode = (path) => statSync(path).mode & 0o777;
const runSh = (script, args, env = {}, options = {}) =>
  spawnSync("sh", [script, ...args], { env: { ...process.env, ...env }, encoding: "utf8", ...options });

function git(args, cwd, env = {}) {
  const r = spawnSync("git", args, { cwd, env: { ...process.env, ...GIT_ENV, ...env }, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")} in ${cwd}: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

function makeTheme(root, name, remoteUrl) {
  const dir = join(root, name);
  mkdirSync(dir);
  git(["init", "-b", "main"], dir);
  writeFileSync(join(dir, "README.md"), `# ${name}\n`);
  git(["add", "-A"], dir);
  git(["commit", "-m", "theme init"], dir);
  git(["submodule", "add", remoteUrl, "vendor/herdr-shared"], dir);
  writeFileSync(join(dir, "herdr-shared.list"), LIST);
  git(["add", "-A"], dir);
  git(["commit", "-m", "add herdr-shared"], dir);
  return dir;
}

function fixture(themes = { "alpha-theme": "true" }) {
  const root = temp("sync-themes-");
  const home = join(root, "home");
  mkdirSync(home);

  const src = join(root, "herdr-shared");
  cpSync(ROOT, src, {
    recursive: true,
    filter: (path) => !/(^|[\\/])\.git([\\/]|$)/.test(path) && !/(^|[\\/])node_modules([\\/]|$)/.test(path),
  });
  git(["init", "-b", "main"], src);
  git(["add", "-A"], src);
  git(["commit", "-m", "herdr-shared fixture"], src);

  const remote = join(root, "herdr-shared.git");
  git(["init", "--bare", remote], root);
  git(["symbolic-ref", "HEAD", "refs/heads/main"], remote);
  git(["remote", "add", "origin", remote], src);
  git(["push", "--quiet", "-u", "origin", "main"], src);

  const dirs = {};
  for (const name of Object.keys(themes)) dirs[name] = makeTheme(root, name, remote);

  const registry = join(root, "themes.list");
  writeFileSync(registry, Object.entries(themes).map(([name, command]) => `${name} ${command}`).join("\n") + "\n");

  return { root, home, src, remote, registry, themes: dirs, initial: git(["rev-parse", "HEAD"], src) };
}

const runSync = (f, args, env = {}) =>
  runSh(join(f.src, "tools/sync-themes.sh"), args, {
    HOME: f.home,
    HERDR_THEMES_ROOT: f.root,
    HERDR_THEMES_LIST: f.registry,
    ...GIT_ENV,
    ...env,
  }, { cwd: f.root });

function advance(f) {
  appendFileSync(join(f.src, "bin/scan.sh"), "\n# synced later\n");
  git(["commit", "-am", "change scan"], f.src);
  git(["push", "--quiet", "origin", "main"], f.src);
  return git(["rev-parse", "HEAD"], f.src);
}

test("vendor.sh --list writes every pair in herdr-shared.list with the exec bits", () => {
  const root = temp("vendor-list-");
  try {
    writeFileSync(join(root, "herdr-shared.list"), "# theme copies\n\naccounts mods/theme-accounts\nscan mods/theme-scan  # cards\n");
    const r = runSh(VENDOR, ["--list", root]);
    assert.equal(r.status, 0, r.stderr);
    for (const name of ACCOUNTS) {
      const copy = join(root, "mods/theme-accounts", name);
      assert.equal(readFileSync(copy, "utf8"), readFileSync(join(BIN, name), "utf8"), name);
      assert.equal(mode(copy), mode(join(BIN, name)), name);
    }
    const scan = join(root, "mods/theme-scan/scan.sh");
    assert.equal(readFileSync(scan, "utf8"), readFileSync(join(BIN, "scan.sh"), "utf8"));
    assert.equal(mode(scan), mode(join(BIN, "scan.sh")));
    assert.equal(mode(join(root, "mods/theme-accounts/cca")), 0o755);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("vendor.sh --list rejects an unknown group and a missing list with exit 2", () => {
  const root = temp("vendor-list-bad-");
  try {
    writeFileSync(join(root, "herdr-shared.list"), "nope mods/x\n");
    const unknown = runSh(VENDOR, ["--list", root]);
    assert.equal(unknown.status, 2);
    assert.match(unknown.stderr, /unknown group nope/);
    assert.equal(existsSync(join(root, "mods/x")), false, "nothing is written for an unknown group");

    const empty = temp("vendor-list-missing-");
    try {
      const missing = runSh(VENDOR, ["--list", empty]);
      assert.equal(missing.status, 2);
      assert.match(missing.stderr, /missing .*herdr-shared\.list/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("vendor.sh --list and check-vendor.sh refuse a list with no entries", () => {
  for (const body of ["", "# only a comment\n\n"]) {
    const root = temp("vendor-empty-");
    try {
      writeFileSync(join(root, "herdr-shared.list"), body);

      const vendored = runSh(VENDOR, ["--list", root]);
      assert.equal(vendored.status, 2);
      assert.match(vendored.stderr, /no entries in .*herdr-shared\.list/);
      assert.equal(existsSync(join(root, "mods")), false, "nothing is written");

      const checked = runSh(CHECK, [root]);
      assert.equal(checked.status, 2);
      assert.match(checked.stderr, /no files listed in .*herdr-shared\.list/);
      assert.doesNotMatch(checked.stdout, /files match/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("a CRLF herdr-shared.list works with vendor.sh --list and check-vendor.sh", () => {
  const root = temp("vendor-crlf-");
  try {
    writeFileSync(join(root, "herdr-shared.list"), "accounts mods/theme-accounts\r\nscan mods/theme-scan\r\n");

    const vendored = runSh(VENDOR, ["--list", root]);
    assert.equal(vendored.status, 0, vendored.stderr);
    assert.equal(readFileSync(join(root, "mods/theme-accounts/cca"), "utf8"), readFileSync(join(BIN, "cca"), "utf8"));
    assert.equal(existsSync(join(root, "mods/theme-scan\r")), false, "the CR is not part of the target dir");

    const checked = runSh(CHECK, [root]);
    assert.equal(checked.status, 0, checked.stderr);
    assert.equal(checked.stdout.trim(), `check-vendor: 6 files match herdr-shared ${spawnSync("git", ["-C", ROOT, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout.trim()}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("check-vendor.sh passes with a count, names a drifted file and a lost exec bit", () => {
  const root = temp("check-vendor-");
  try {
    writeFileSync(join(root, "herdr-shared.list"), LIST);
    assert.equal(runSh(VENDOR, ["--list", root]).status, 0);
    const short = spawnSync("git", ["-C", ROOT, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout.trim();

    const ok = runSh(CHECK, [root]);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.stdout.trim(), `check-vendor: 6 files match herdr-shared ${short}`);

    appendFileSync(join(root, "mods/theme-scan/scan.sh"), "\ndrift\n");
    const edited = runSh(CHECK, [root]);
    assert.equal(edited.status, 1);
    assert.match(edited.stdout, /mods\/theme-scan\/scan\.sh differs from bin\/scan\.sh; run vendor\/herdr-shared\/tools\/vendor\.sh --list \./);

    assert.equal(runSh(VENDOR, ["--list", root]).status, 0);
    chmodSync(join(root, "mods/theme-accounts/cca"), 0o644);
    const lost = runSh(CHECK, [root]);
    assert.equal(lost.status, 1);
    assert.match(lost.stdout, /mods\/theme-accounts\/cca differs from bin\/cca/);
    assert.doesNotMatch(lost.stdout, /mods\/theme-scan\/scan\.sh differs/);

    const empty = temp("check-vendor-missing-");
    try {
      const missing = runSh(CHECK, [empty]);
      assert.equal(missing.status, 2);
      assert.match(missing.stderr, /missing .*herdr-shared\.list/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sync-themes.sh updates the copies and pointer, commits them, then reports already", () => {
  const f = fixture();
  try {
    const theme = f.themes["alpha-theme"];
    const sha = advance(f);
    const short = sha.slice(0, 7);
    writeFileSync(join(theme, "stray.txt"), "untracked\n");

    const r = runSync(f, ["--commit"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^alpha-theme: committed$/m);

    assert.equal(readFileSync(join(theme, "mods/theme-scan/scan.sh"), "utf8"), readFileSync(join(f.src, "bin/scan.sh"), "utf8"));
    assert.equal(readFileSync(join(theme, "mods/theme-accounts/cca"), "utf8"), readFileSync(join(f.src, "bin/cca"), "utf8"));
    assert.equal(mode(join(theme, "mods/theme-accounts/cca")), 0o755);
    assert.equal(git(["rev-parse", "HEAD"], join(theme, "vendor/herdr-shared")), sha);

    const message = git(["log", "-1", "--format=%B"], theme);
    assert.equal(message.split("\n")[0], `chore: herdr-shared ${short} 반영`);
    assert.match(message, /^- mods\/theme-accounts\/cca$/m);
    assert.match(message, /^- mods\/theme-scan\/scan\.sh$/m);
    assert.match(message, /^- vendor\/herdr-shared$/m);
    assert.doesNotMatch(git(["ls-tree", "-r", "--name-only", "HEAD"], theme), /stray\.txt/, "untracked files are never added");

    const committed = git(["rev-parse", "HEAD"], theme);
    const again = runSync(f, ["--commit"]);
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, new RegExp(`^alpha-theme: already at ${short}$`, "m"));
    assert.equal(git(["rev-parse", "HEAD"], theme), committed, "a second run commits nothing");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("sync-themes.sh commits only the vendored files, not an unlisted file in a target dir", () => {
  const f = fixture();
  try {
    const theme = f.themes["alpha-theme"];
    const sha = advance(f);
    const short = sha.slice(0, 7);
    mkdirSync(join(theme, "mods/theme-accounts"), { recursive: true });
    writeFileSync(join(theme, "mods/theme-accounts/mine.txt"), "mine\n");

    const r = runSync(f, ["--commit"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^alpha-theme: committed$/m);

    const committed = git(["show", "--name-only", "--format=", "HEAD"], theme).split("\n").filter(Boolean);
    assert.ok(committed.includes("mods/theme-accounts/cca"), committed.join(","));
    assert.ok(committed.includes("mods/theme-scan/scan.sh"), committed.join(","));
    assert.ok(committed.includes("vendor/herdr-shared"), committed.join(","));
    assert.ok(!committed.includes("mods/theme-accounts/mine.txt"), "the unlisted file is not committed");
    assert.match(git(["status", "--porcelain", "--", "mods/theme-accounts/mine.txt"], theme), /^\?\? /, "it stays untracked");

    const again = runSync(f, ["--commit"]);
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, new RegExp(`^alpha-theme: already at ${short}$`, "m"));
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("sync-themes.sh refuses a branch with no upstream before touching any theme", () => {
  const f = fixture();
  try {
    git(["checkout", "-b", "local-only"], f.src);
    appendFileSync(join(f.src, "bin/scan.sh"), "\n# no upstream\n");
    git(["commit", "-am", "local only, no upstream"], f.src);
    const upstream = spawnSync("git", ["rev-parse", "--abbrev-ref", "@{u}"], {
      cwd: f.src,
      env: { ...process.env, ...GIT_ENV },
      encoding: "utf8",
    });
    assert.notEqual(upstream.status, 0, "the branch really has no upstream");

    const theme = f.themes["alpha-theme"];
    const r = runSync(f, ["--commit"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not on any upstream branch/);
    assert.equal(git(["rev-parse", "HEAD"], join(theme, "vendor/herdr-shared")), f.initial, "the pointer is untouched");
    assert.equal(existsSync(join(theme, "mods")), false, "the theme is not touched");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("sync-themes.sh refuses a dirty theme before touching any theme", () => {
  const f = fixture({ "alpha-theme": "true", "beta-theme": "true" });
  try {
    const alpha = f.themes["alpha-theme"];
    const beta = f.themes["beta-theme"];
    advance(f);
    writeFileSync(join(beta, "README.md"), "# beta, edited\n");

    const r = runSync(f, []);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /beta-theme has uncommitted changes/);
    assert.equal(git(["rev-parse", "HEAD"], join(alpha, "vendor/herdr-shared")), f.initial, "alpha keeps its pointer");
    assert.equal(existsSync(join(alpha, "mods")), false, "alpha is not touched");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("sync-themes.sh refuses an unpushed HEAD", () => {
  const f = fixture();
  try {
    appendFileSync(join(f.src, "bin/scan.sh"), "\n# local only\n");
    git(["commit", "-am", "local only"], f.src);

    const r = runSync(f, []);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not on any upstream branch/);
    assert.equal(git(["rev-parse", "HEAD"], join(f.themes["alpha-theme"], "vendor/herdr-shared")), f.initial);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("sync-themes.sh stops on a failing theme test and leaves the tree for inspection", () => {
  const f = fixture({ "alpha-theme": "sh -c 'echo boom >&2; exit 3'" });
  try {
    const theme = f.themes["alpha-theme"];
    const before = git(["rev-parse", "HEAD"], theme);
    advance(f);

    const r = runSync(f, ["--commit"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /alpha-theme: test command/);
    assert.equal(git(["rev-parse", "HEAD"], theme), before, "nothing is committed");
    assert.notEqual(git(["status", "--porcelain"], theme), "", "the updated copies stay for inspection");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("sync-themes.sh --push reports a theme without an origin", () => {
  const f = fixture();
  try {
    const theme = f.themes["alpha-theme"];
    advance(f);
    const r = runSync(f, ["--commit", "--push"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^alpha-theme: no origin; publish it with its own flow$/m);
    assert.match(r.stdout, /^alpha-theme: no-origin$/m);
    const short = git(["rev-parse", "--short", "HEAD"], f.src);
    assert.equal(git(["log", "-1", "--format=%s"], theme), `chore: herdr-shared ${short} 반영`);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("sync-themes.sh --push pushes to a theme's bare origin", () => {
  const f = fixture();
  try {
    const theme = f.themes["alpha-theme"];
    const origin = join(f.root, "theme-origin.git");
    git(["init", "--bare", origin], f.root);
    git(["remote", "add", "origin", origin], theme);
    advance(f);

    const r = runSync(f, ["--commit", "--push"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^alpha-theme: pushed$/m);
    const head = git(["rev-parse", "HEAD"], theme);
    assert.equal(git([`--git-dir=${origin}`, "rev-parse", "refs/heads/main"], f.root), head);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
