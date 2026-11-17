import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE_TAP = fileURLToPath(new URL("../bin/usage-tap.sh", import.meta.url));

function setup(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const home = join(root, "home");
  const state = join(root, "state");
  mkdirSync(home);
  mkdirSync(state);

  const capture = join(root, "wrapped-stdin");
  const wrapped = join(root, "wrapped.sh");
  writeFileSync(wrapped, '#!/bin/sh\ncat > "$STDIN_CAPTURE"\nexit 7\n');
  chmodSync(wrapped, 0o755);
  return { root, home, state, capture, wrapped };
}

const payload = (five, seven) =>
  JSON.stringify({ rate_limits: { five_hour: five, seven_day: seven } });
const win = (used, resets_at) => ({ used_percentage: used, resets_at });
const stored = (used, resets_at) => ({ used, resets_at });
const usageFile = (s, account) => join(s.state, "herdr-tower/usage", `${account}.json`);
const record = (s, account) => JSON.parse(readFileSync(usageFile(s, account), "utf8"));

const run = (s, input, env = {}) =>
  spawnSync("sh", [USAGE_TAP, s.wrapped], {
    input,
    env: {
      ...process.env,
      HOME: s.home,
      XDG_STATE_HOME: s.state,
      STDIN_CAPTURE: s.capture,
      ...env,
    },
    encoding: "utf8",
  });

test("the default config dir records both windows and passes stdin through", () => {
  const s = setup("usage-default-");
  try {
    const input = payload(win(42, 1000), win(7, 9000));
    const r = run(s, input, { CLAUDE_CONFIG_DIR: join(s.home, ".claude") });
    assert.equal(r.status, 7, "the wrapped command runs and its status is kept");
    assert.equal(readFileSync(s.capture, "utf8"), input, "the wrapped command gets the same stdin");
    const rec = record(s, "default");
    assert.deepEqual(rec.five_hour, stored(42, 1000));
    assert.deepEqual(rec.seven_day, stored(7, 9000));
    assert.equal(typeof rec.updated_at, "number");
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("a named account config dir records under that name", () => {
  const s = setup("usage-named-");
  try {
    const input = payload(win(11, 1000), win(22, 9000));
    const r = run(s, input, { CLAUDE_CONFIG_DIR: join(s.home, ".claude-accounts/personal") });
    assert.equal(r.status, 7, r.stderr);
    assert.equal(readFileSync(s.capture, "utf8"), input);
    assert.equal(existsSync(usageFile(s, "default")), false);
    assert.deepEqual(record(s, "personal").five_hour, stored(11, 1000));
    assert.deepEqual(record(s, "personal").seven_day, stored(22, 9000));
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("inside one window the larger value is kept", () => {
  const s = setup("usage-larger-");
  const config = join(s.home, ".claude");
  try {
    run(s, payload(win(40, 1000), null), { CLAUDE_CONFIG_DIR: config });
    const smaller = run(s, payload(win(30, 1000), null), { CLAUDE_CONFIG_DIR: config });
    assert.equal(smaller.status, 7);
    assert.deepEqual(record(s, "default").five_hour, stored(40, 1000));

    run(s, payload(win(55, 1000), null), { CLAUDE_CONFIG_DIR: config });
    assert.deepEqual(record(s, "default").five_hour, stored(55, 1000));
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("a resets_at more than an hour later is a new window", () => {
  const s = setup("usage-newwindow-");
  const config = join(s.home, ".claude");
  try {
    run(s, payload(win(80, 1000), null), { CLAUDE_CONFIG_DIR: config });
    const next = run(s, payload(win(10, 5000), null), { CLAUDE_CONFIG_DIR: config });
    assert.equal(next.status, 7);
    assert.deepEqual(record(s, "default").five_hour, stored(10, 5000));
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("another config dir records nothing but still runs the wrapped command", () => {
  const s = setup("usage-othercfg-");
  try {
    const input = payload(win(50, 1000), win(60, 9000));
    const r = run(s, input, { CLAUDE_CONFIG_DIR: join(s.home, ".config/elsewhere") });
    assert.equal(r.status, 7);
    assert.equal(readFileSync(s.capture, "utf8"), input);
    assert.equal(existsSync(join(s.state, "herdr-tower")), false);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("a payload without rate limits records nothing and passes stdin through", () => {
  const s = setup("usage-badpayload-");
  try {
    const input = "{ not json\n";
    const r = run(s, input, { CLAUDE_CONFIG_DIR: join(s.home, ".claude") });
    assert.equal(r.status, 7);
    assert.equal(readFileSync(s.capture, "utf8"), input);
    assert.equal(existsSync(join(s.state, "herdr-tower/usage")), false);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});
