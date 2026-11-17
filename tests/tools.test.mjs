import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BIN = join(ROOT, "bin");
const VENDOR = join(ROOT, "tools/vendor.sh");
const INSTALL = join(ROOT, "tools/install.sh");
const LINK = join(ROOT, "tools/link-installed.sh");

const temp = (prefix) => mkdtempSync(join(tmpdir(), prefix));
const run = (script, args, env = {}, options = {}) =>
  spawnSync("sh", [script, ...args], { env: { ...process.env, ...env }, encoding: "utf8", ...options });
const mode = (path) => statSync(path).mode & 0o777;

test("vendor.sh copies a group and prints each file, keeping the exec bit", () => {
  const root = temp("vendor-accounts-");
  try {
    const target = join(root, "mods/arcade-accounts");
    const r = run(VENDOR, ["accounts", target]);
    assert.equal(r.status, 0, r.stderr);
    const files = ["cca", "usage-tap.sh", "usage-api.mjs", "codex-usage.mjs", "models.mjs"];
    const printed = r.stdout.trim().split("\n");
    assert.deepEqual(printed, files.map((name) => join(target, name)));
    for (const name of files) {
      assert.equal(readFileSync(join(target, name), "utf8"), readFileSync(join(BIN, name), "utf8"), name);
      assert.equal(mode(join(target, name)), mode(join(BIN, name)), name);
    }
    assert.equal(mode(join(target, "cca")), 0o755);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("vendor.sh takes several group and target pairs in one call", () => {
  const root = temp("vendor-many-");
  try {
    const editor = join(root, "mods/inkpaw-editor");
    const tools = join(root, "tools");
    const open = join(root, "tools/herdr-open");
    const r = run(VENDOR, ["editor", editor, "merge-keys", tools, "herdr-open", open]);
    assert.equal(r.status, 0, r.stderr);
    for (const name of ["hv", "hv-open"]) assert.ok(existsSync(join(editor, name)), name);
    assert.ok(existsSync(join(tools, "merge-keys.py")));
    for (const name of ["build.sh", "open.applescript", "set-default.swift"]) assert.ok(existsSync(join(open, name)), name);
    assert.equal(mode(join(open, "build.sh")), 0o755);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("vendor.sh refuses an unknown group and an odd argument list", () => {
  const root = temp("vendor-bad-");
  try {
    const unknown = run(VENDOR, ["nope", join(root, "x")]);
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /unknown group nope/);
    assert.equal(existsSync(join(root, "x")), false, "nothing is created for an unknown group");
    const odd = run(VENDOR, ["accounts"]);
    assert.notEqual(odd.status, 0);
    assert.match(odd.stderr, /usage:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("vendor.sh fails on a missing source only for the group requested", () => {
  const root = temp("vendor-missing-");
  try {
    // A repo-shaped tree without bin/scan.sh, so the real repo's files are never touched.
    mkdirSync(join(root, "tools"), { recursive: true });
    mkdirSync(join(root, "bin"));
    copyFileSync(VENDOR, join(root, "tools/vendor.sh"));
    for (const name of ["cca", "usage-tap.sh", "usage-api.mjs", "codex-usage.mjs", "models.mjs"]) {
      copyFileSync(join(BIN, name), join(root, "bin", name));
    }
    const script = join(root, "tools/vendor.sh");
    const target = join(root, "out");
    const ok = run(script, ["accounts", target]);
    assert.equal(ok.status, 0, ok.stderr);
    const scan = run(script, ["scan", join(root, "scan-out")]);
    assert.equal(scan.status, 1);
    assert.match(scan.stderr, /missing .*bin\/scan\.sh for group scan/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("install.sh copies bin into the shared home and replaces it whole", () => {
  const home = temp("shared-install-");
  const dest = join(home, "herdr-shared");
  try {
    mkdirSync(dest);
    writeFileSync(join(dest, "stale"), "old\n");
    const r = run(INSTALL, [], { HERDR_SHARED_HOME: dest });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(join(dest, "stale")), false, "the old folder is replaced whole");
    for (const name of ["cca", "usage-tap.sh", "usage-api.mjs", "codex-usage.mjs", "models.mjs"]) {
      assert.equal(readFileSync(join(dest, name), "utf8"), readFileSync(join(BIN, name), "utf8"), name);
      assert.equal(mode(join(dest, name)), mode(join(BIN, name)), name);
    }
    assert.equal(mode(join(dest, "cca")), 0o755);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("install.sh refuses an empty, /, HOME, relative or oddly named destination", () => {
  const home = temp("shared-refuse-");
  try {
    const sentinel = join(home, "keep.txt");
    writeFileSync(sentinel, "keep\n");
    const dest = join(home, "shared");
    mkdirSync(dest);
    writeFileSync(join(dest, "keep.txt"), "keep\n");
    const cases = [
      { env: { HERDR_SHARED_HOME: "" }, why: "empty" },
      { env: { HERDR_SHARED_HOME: "/" }, why: "/" },
      { env: { HERDR_SHARED_HOME: home, HOME: home }, why: "HOME" },
      { env: { HERDR_SHARED_HOME: "herdr-shared", HOME: home }, why: "relative", cwd: home },
      { env: { HERDR_SHARED_HOME: dest, HOME: home }, why: "not herdr-shared" },
    ];
    for (const { env, why, cwd } of cases) {
      const r = run(INSTALL, [], env, cwd ? { cwd } : {});
      assert.equal(r.status, 2, why);
      assert.equal(r.stderr.trim().split("\n").length, 1, why);
      assert.match(r.stderr, /refusing to install into/, why);
      assert.equal(readFileSync(sentinel, "utf8"), "keep\n", why);
      assert.equal(readFileSync(join(dest, "keep.txt"), "utf8"), "keep\n", why);
      assert.equal(existsSync(join(home, "herdr-shared")), false, why);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("install.sh leaves the old folder untouched when the copy fails", () => {
  const home = temp("shared-copyfail-");
  const dest = join(home, "herdr-shared");
  try {
    mkdirSync(dest);
    writeFileSync(join(dest, "stale"), "old\n");
    const r = run(INSTALL, [], {
      HOME: home,
      HERDR_SHARED_HOME: dest,
      HERDR_SHARED_SRC: join(home, "no-such-source"),
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /copy from .* failed/);
    assert.equal(readFileSync(join(dest, "stale"), "utf8"), "old\n");
    assert.deepEqual(readdirSync(home), ["herdr-shared"], "no temp or old folder is left behind");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("link-installed.sh leaves the shared home's own files alone", () => {
  const root = temp("shared-self-");
  const shared = join(root, "herdr-shared");
  try {
    mkdirSync(shared);
    writeFileSync(join(shared, "cca"), "shared cca\n");
    writeFileSync(join(shared, "models.mjs"), "shared models\n");

    const r = run(LINK, [shared], { HERDR_SHARED_HOME: shared });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "");
    for (const [name, body] of [["cca", "shared cca\n"], ["models.mjs", "shared models\n"]]) {
      assert.equal(lstatSync(join(shared, name)).isSymbolicLink(), false, name);
      assert.equal(readFileSync(join(shared, name), "utf8"), body, name);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("link-installed.sh skips a mod file that already links to the shared home", () => {
  const root = temp("shared-relink-");
  const shared = join(root, "shared");
  const mod = join(root, "mods/inkpaw-shed");
  try {
    mkdirSync(shared);
    mkdirSync(mod, { recursive: true });
    writeFileSync(join(shared, "cca"), "shared cca\n");
    symlinkSync(join(shared, "cca"), join(mod, "cca"));

    const r = run(LINK, [mod], { HERDR_SHARED_HOME: shared });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "");
    assert.equal(lstatSync(join(mod, "cca")).isSymbolicLink(), true);
    assert.equal(readlinkSync(join(mod, "cca")), join(shared, "cca"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("link-installed.sh links the shared names, prints them and leaves the rest alone", () => {
  const root = temp("shared-link-");
  const shared = join(root, "shared");
  const mod = join(root, "mods/inkpaw-shed");
  try {
    mkdirSync(shared);
    mkdirSync(mod, { recursive: true });
    writeFileSync(join(shared, "cca"), "shared cca\n");
    writeFileSync(join(shared, "models.mjs"), "shared models\n");
    writeFileSync(join(mod, "cca"), "vendored cca\n");
    writeFileSync(join(mod, "models.mjs"), "vendored models\n");
    writeFileSync(join(mod, "main.js"), "the mod\n");
    writeFileSync(join(mod, "mod.json"), "{}\n");

    const r = run(LINK, [mod], { HERDR_SHARED_HOME: shared });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim().split("\n").length, 2);
    assert.match(r.stdout, /linked .*cca/);
    assert.match(r.stdout, /linked .*models\.mjs/);

    for (const name of ["cca", "models.mjs"]) {
      assert.equal(lstatSync(join(mod, name)).isSymbolicLink(), true, name);
      assert.equal(readlinkSync(join(mod, name)), join(shared, name));
      assert.equal(readFileSync(join(mod, name), "utf8"), readFileSync(join(shared, name), "utf8"));
    }
    assert.equal(lstatSync(join(mod, "main.js")).isSymbolicLink(), false, "files not in the shared home stay copies");
    assert.equal(readFileSync(join(mod, "main.js"), "utf8"), "the mod\n");
    assert.equal(lstatSync(join(mod, "mod.json")).isSymbolicLink(), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("link-installed.sh leaves a folder alone when the shared home is missing", () => {
  const root = temp("shared-absent-");
  try {
    const mod = join(root, "mods/inkpaw-shed");
    mkdirSync(mod, { recursive: true });
    writeFileSync(join(mod, "cca"), "vendored cca\n");
    const r = run(LINK, [mod], { HERDR_SHARED_HOME: join(root, "no-such-home") });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "");
    assert.equal(lstatSync(join(mod, "cca")).isSymbolicLink(), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("link-installed.sh refuses a missing folder", () => {
  const root = temp("shared-baddir-");
  try {
    const r = run(LINK, [join(root, "nope")], { HERDR_SHARED_HOME: join(root, "shared") });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /is not a folder/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
