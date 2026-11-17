import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(ROOT, "tools/merge-keys.py");
const TAG = "night-city";
const ZONES = ["layout:night-city-downtown", "layout:night-city-downtown-demo"];

const SOURCE_BODY = {
  "layout:night-city-downtown": {
    "ctrl-alt-p": "night-city-street.toggle",
    "ctrl-alt-/": "night-city-street.legend",
    "cmd-0": "night-city-street.font_reset",
  },
  "layout:night-city-downtown-demo": {
    "ctrl-alt-p": "night-city-street.toggle",
    "ctrl-alt-/": "night-city-street.legend",
    "cmd-0": "night-city-street.font_reset",
  },
};

const tempDir = (prefix) => mkdtempSync(join(tmpdir(), prefix));
const tempKeys = () => join(tempDir("shared-keys-"), "keys.json");
const sourceKeys = () => {
  const path = join(tempDir("shared-layout-"), "layout.keys.json");
  writeFileSync(path, JSON.stringify(SOURCE_BODY));
  return path;
};
const merge = (target, source = sourceKeys(), extra = []) =>
  execFileSync("python3", ["-I", SCRIPT, target, source, "--backup-tag", TAG, ...extra], { encoding: "utf8" });
const backups = (target) =>
  readdirSync(dirname(target)).filter((name) => name.startsWith("keys.json.bak-night-city-"));

test("a missing target is created with both zones", () => {
  const target = tempKeys();
  const out = merge(target);

  assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), SOURCE_BODY);
  assert.match(out, /added/);
  assert.equal(backups(target).length, 0);
});

test("an existing target keeps its other zones and gets a backup", () => {
  const target = tempKeys();
  const original = { global: { "cmd-q": "app.quit" }, "layout:main": { "cmd-x": "x.y" } };
  writeFileSync(target, JSON.stringify(original));

  merge(target);

  const keys = JSON.parse(readFileSync(target, "utf8"));
  assert.deepEqual(keys.global, original.global);
  assert.deepEqual(keys["layout:main"], original["layout:main"]);
  for (const zone of ZONES) assert.deepEqual(keys[zone], SOURCE_BODY[zone]);

  const made = backups(target);
  assert.equal(made.length, 1);
  assert.match(made[0], /^keys\.json\.bak-night-city-\d+$/);
  assert.deepEqual(JSON.parse(readFileSync(join(dirname(target), made[0]), "utf8")), original);
});

test("the backup tag names the backup file", () => {
  const target = tempKeys();
  const source = sourceKeys();
  writeFileSync(target, JSON.stringify({ global: {} }));
  const out = execFileSync("python3", ["-I", SCRIPT, target, source, "--backup-tag", "regent"], { encoding: "utf8" });
  assert.match(out, /added/);
  assert.equal(readdirSync(dirname(target)).filter((name) => /^keys\.json\.bak-regent-\d+$/.test(name)).length, 1);
});

test("a second run changes nothing and makes no backup", () => {
  const target = tempKeys();
  const source = sourceKeys();
  merge(target, source);
  const content = readFileSync(target, "utf8");
  const before = backups(target);

  const out = merge(target, source);

  assert.equal(readFileSync(target, "utf8"), content);
  assert.deepEqual(backups(target), before);
  assert.match(out, /nothing to add/);
});

test("a binding the person already has is kept and named", () => {
  const target = tempKeys();
  writeFileSync(target, JSON.stringify({ "layout:night-city-downtown": { "ctrl-alt-p": "pulse.toggle" } }));

  const out = merge(target);

  const keys = JSON.parse(readFileSync(target, "utf8"));
  assert.equal(keys["layout:night-city-downtown"]["ctrl-alt-p"], "pulse.toggle");
  assert.equal(keys["layout:night-city-downtown"]["cmd-0"], "night-city-street.font_reset");
  assert.match(out, /ctrl-alt-p/);
  assert.match(out, /pulse\.toggle/);
});

test("invalid JSON in the target exits 1 and leaves the file untouched", () => {
  const target = tempKeys();
  const original = "{ not json\n";
  writeFileSync(target, original);

  assert.throws(
    () => merge(target),
    (err) => {
      assert.equal(err.status, 1);
      assert.equal(err.stderr.trim().split("\n").length, 1);
      return true;
    },
  );
  assert.equal(readFileSync(target, "utf8"), original);
});

test("a symlinked target is written through to the file it points at", () => {
  const base = tempDir("shared-keys-link-");
  const realDir = join(base, "real");
  const linkDir = join(base, "link");
  mkdirSync(realDir);
  mkdirSync(linkDir);
  const real = join(realDir, "keys.json");
  const original = { global: { "cmd-q": "app.quit" } };
  writeFileSync(real, JSON.stringify(original));
  const link = join(linkDir, "keys.json");
  symlinkSync(real, link);

  merge(link);

  assert.equal(lstatSync(link).isSymbolicLink(), true, "the link stays a link");
  const keys = JSON.parse(readFileSync(real, "utf8"));
  assert.deepEqual(keys.global, original.global);
  for (const zone of ZONES) assert.deepEqual(keys[zone], SOURCE_BODY[zone]);
  const made = readdirSync(realDir).filter((name) => name.startsWith("keys.json.bak-night-city-"));
  assert.equal(made.length, 1, "the backup sits beside the file the link points at");
  assert.deepEqual(readdirSync(linkDir), ["keys.json"]);
});

test("a target that is not UTF-8 exits 1 with one line and stays untouched", () => {
  const target = tempKeys();
  const original = Buffer.from([0x7b, 0xff, 0xfe, 0x7d]);
  writeFileSync(target, original);

  assert.throws(
    () => merge(target),
    (err) => {
      assert.equal(err.status, 1);
      assert.equal(err.stderr.trim().split("\n").length, 1);
      assert.match(err.stderr, /not UTF-8/);
      return true;
    },
  );
  assert.deepEqual(readFileSync(target), original);
});

test("a backup tag that is empty or holds unsafe characters is refused", () => {
  for (const tag of ["", ".", "..", "../x", "a b", "a/b", "tag\n"]) {
    const target = tempKeys();
    const source = sourceKeys();
    const r = spawnSync("python3", ["-I", SCRIPT, target, source, "--backup-tag", tag], { encoding: "utf8" });
    assert.equal(r.status, 1, JSON.stringify(tag));
    assert.match(r.stderr, /usage: merge-keys\.py <target keys\.json> <source keys\.json> --backup-tag <tag>/, JSON.stringify(tag));
    assert.equal(existsSync(target), false, `${JSON.stringify(tag)} writes nothing`);
  }
});

test("a run without a backup tag prints the usage and exits 1", () => {
  const target = tempKeys();
  const source = sourceKeys();
  const r = spawnSync("python3", ["-I", SCRIPT, target, source], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage: merge-keys\.py <target keys\.json> <source keys\.json> --backup-tag <tag>/);
  assert.equal(backups(target).length, 0, "nothing is written without a tag");
});
