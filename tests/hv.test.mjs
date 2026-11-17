import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HV = fileURLToPath(new URL("../bin/hv", import.meta.url));

// A herdr-app stub that records the split payload; hv calls it as `herdr-app do pane.split <json>`.
function setup(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const app = join(bin, "herdr-app");
  writeFileSync(app, '#!/bin/sh\ncase "$1" in ls) exit 0 ;; do) printf %s "$3" > "$HV_CAPTURE" ;; esac\n');
  chmodSync(app, 0o755);
  const capture = join(root, "payload.json");
  const file = join(root, "note.txt");
  writeFileSync(file, "hello\n");
  return { root, app, capture, file };
}

function modDir(root, name) {
  const dir = join(root, "mods", name);
  mkdirSync(dir, { recursive: true });
  copyFileSync(HV, join(dir, "hv"));
  chmodSync(join(dir, "hv"), 0o755);
  return join(dir, "hv");
}

const run = (hv, args, env) =>
  spawnSync("sh", [hv, ...args], { env: { ...process.env, ...env }, encoding: "utf8" });

test("hv takes the mod id from the folder it sits in", () => {
  const { root, app, capture, file } = setup("hv-mod-");
  try {
    const r = run(modDir(root, "night-city-editor"), [file], { HERDR_APP: app, HV_CAPTURE: capture });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(readFileSync(capture, "utf8")).mod, "night-city-editor");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the same file serves another theme's folder", () => {
  const { root, app, capture, file } = setup("hv-theme-");
  try {
    const r = run(modDir(root, "inkpaw-editor"), [file], { HERDR_APP: app, HV_CAPTURE: capture });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(readFileSync(capture, "utf8")).mod, "inkpaw-editor");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("HV_MOD overrides the folder name", () => {
  const { root, app, capture, file } = setup("hv-override-");
  try {
    const r = run(modDir(root, "shared"), [file],
      { HERDR_APP: app, HV_CAPTURE: capture, HV_MOD: "fm-editor" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(readFileSync(capture, "utf8")).mod, "fm-editor");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a folder that is not an editor mod is refused with one line and exit 2", () => {
  const { root, app, capture, file } = setup("hv-bad-");
  try {
    const r = run(modDir(root, "unrelated"), [file], { HERDR_APP: app, HV_CAPTURE: capture });
    assert.equal(r.status, 2);
    assert.equal(r.stderr.trim().split("\n").length, 1);
    assert.match(r.stderr, /set HV_MOD/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
