import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HV_OPEN = fileURLToPath(new URL("../bin/hv-open", import.meta.url));

// hv-open runs "$HERE/hv", so the stub and a copy of hv-open share one mod folder.
function setup(prefix, hvStatus) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const mod = join(root, "mods", "night-city-editor");
  mkdirSync(mod, { recursive: true });
  copyFileSync(HV_OPEN, join(mod, "hv-open"));
  const hv = join(mod, "hv");
  writeFileSync(hv, `#!/bin/sh\nexit ${hvStatus}\n`);
  chmodSync(hv, 0o755);

  const state = join(root, "state");
  const calls = join(root, "open-calls");
  const open = join(root, "open-stub");
  writeFileSync(
    open,
    '#!/bin/sh\necho call >> "$OPEN_CAPTURE"\nfor arg in "$@"; do echo "$arg" >> "$OPEN_CAPTURE"; done\nexit 0\n',
  );
  chmodSync(open, 0o755);

  const file = join(root, "note.txt");
  writeFileSync(file, "hello\n");
  return { root, mod, state, calls, open, file };
}

const run = (s, file, env = {}) =>
  spawnSync("sh", [join(s.mod, "hv-open"), file], {
    env: { ...process.env, XDG_STATE_HOME: s.state, OPEN: s.open, OPEN_CAPTURE: s.calls, ...env },
    encoding: "utf8",
  });

const calls = (s) => (existsSync(s.calls) ? readFileSync(s.calls, "utf8").trim().split("\n") : []);
const logLine = (s) => {
  const lines = readFileSync(join(s.state, "herdr-tower/open.log"), "utf8").trim().split("\n");
  return lines[lines.length - 1].split("\t");
};

function previous(s, rows) {
  mkdirSync(join(s.state, "herdr-tower"), { recursive: true });
  writeFileSync(join(s.state, "herdr-tower/open-previous.tsv"), rows.map((row) => row.join("\t")).join("\n") + "\n");
}

test("a file the editor takes goes to the editor, without calling open", () => {
  const s = setup("hv-open-editor-", 0);
  try {
    const r = run(s, s.file);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(calls(s), [], "open is not called when hv succeeds");
    const line = logLine(s);
    assert.equal(line.length, 3);
    assert.match(line[0], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    assert.equal(line[1], s.file);
    assert.equal(line[2], "editor");
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("an extension with a previous app opens that app and logs the route", () => {
  const s = setup("hv-open-previous-", 1);
  try {
    previous(s, [["txt", "TextEdit"]]);
    const r = run(s, s.file);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(calls(s), ["call", "-a", "TextEdit", s.file]);
    const line = logLine(s);
    assert.equal(line[1], s.file);
    assert.equal(line[2], "previous:TextEdit");
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("an extension with no previous app opens as text and logs the route", () => {
  const s = setup("hv-open-text-", 1);
  try {
    const r = run(s, s.file);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(calls(s), ["call", "-t", s.file]);
    const line = logLine(s);
    assert.equal(line[1], s.file);
    assert.equal(line[2], "text");
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("a previous app recorded for another extension is not used", () => {
  const s = setup("hv-open-otherext-", 1);
  try {
    previous(s, [["md", "Typora"]]);
    const r = run(s, s.file);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(calls(s), ["call", "-t", s.file]);
    assert.equal(logLine(s)[2], "text");
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});
