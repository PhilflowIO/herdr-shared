import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { weekOf } from "../bin/usage-api.mjs";

const CCA = new URL("../bin/cca", import.meta.url).pathname;

test("weekOf reads the weekly_all row", () => {
  const body = { limits: [
    { kind: "weekly_scoped", scope: { model: { display_name: "Fable" } }, percent: 0, resets_at: "2026-11-19T18:00:00+00:00" },
    { kind: "weekly_all", percent: 10, resets_at: "2026-11-19T17:59:59.816284+00:00" },
  ] };
  assert.deepEqual(weekOf(body), { used: 10, resets_at: 1795111200 });
  assert.equal(weekOf({ limits: [] }), null);
  assert.equal(weekOf(null), null);
});

// Runs `cca --porcelain` against a scratch HOME and state folder and returns default's U line.
function weekLine(tap, api) {
  const root = mkdtempSync(join(tmpdir(), "cca-week-"));
  const state = join(root, "state");
  const usage = join(state, "herdr-tower", "usage");
  mkdirSync(usage, { recursive: true });
  mkdirSync(join(root, "home"), { recursive: true });
  // A fresh stamp keeps api_refresh from fetching real data over the fixtures.
  writeFileSync(join(usage, ".api-fetch"), "");
  if (tap) writeFileSync(join(usage, "default.json"), JSON.stringify(tap));
  if (api) writeFileSync(join(usage, "default.api.json"), JSON.stringify(api));
  const out = execFileSync("sh", [CCA, "--porcelain"], {
    env: { PATH: process.env.PATH, HOME: join(root, "home"), XDG_STATE_HOME: state },
    encoding: "utf8",
  });
  const line = out.split("\n").find((l) => l.startsWith("U\tdefault\t"));
  return line.split("\t").slice(4, 6);
}

const NOW = Math.floor(Date.now() / 1000);
const RESET = NOW + 2 * 86400;

test("after a reset pass the endpoint's lower week replaces the tap's stuck value", () => {
  // The 5h window keeps rewriting the tap file, so its updated_at is newer than the endpoint read.
  const tap = { five_hour: { used: 3, resets_at: NOW + 3600 }, seven_day: { used: 99, resets_at: RESET }, updated_at: NOW };
  const api = { fetched_at: NOW - 120, fable: { used: 0, resets_at: RESET }, seven_day: { used: 10, resets_at: RESET } };
  assert.deepEqual(weekLine(tap, api), ["10", String(RESET)]);
});

test("a stale endpoint read leaves the tap's week alone", () => {
  const tap = { seven_day: { used: 40, resets_at: RESET }, updated_at: NOW };
  const api = { fetched_at: NOW - 3600, seven_day: { used: 10, resets_at: RESET } };
  assert.deepEqual(weekLine(tap, api), ["40", String(RESET)]);
});

test("an endpoint read for the previous window leaves the tap's new week alone", () => {
  const tap = { seven_day: { used: 2, resets_at: RESET }, updated_at: NOW };
  const api = { fetched_at: NOW - 60, seven_day: { used: 80, resets_at: RESET - 7 * 86400 } };
  assert.deepEqual(weekLine(tap, api), ["2", String(RESET)]);
});

test("an endpoint record without a week leaves the tap's week alone", () => {
  const tap = { seven_day: { used: 40, resets_at: RESET }, updated_at: NOW - 600 };
  const api = { fetched_at: NOW - 60, fable: { used: 3, resets_at: RESET } };
  assert.deepEqual(weekLine(tap, api), ["40", String(RESET)]);
});

test("the endpoint's week shows when the tap has never written", () => {
  const api = { fetched_at: NOW - 3600, seven_day: { used: 10, resets_at: RESET } };
  assert.deepEqual(weekLine(null, api), ["10", String(RESET)]);
});

test("an endpoint read for a later window replaces the tap's previous week", () => {
  const tap = { seven_day: { used: 99, resets_at: RESET - 7 * 86400 }, updated_at: NOW };
  const api = { fetched_at: NOW - 60, seven_day: { used: 1, resets_at: RESET } };
  assert.deepEqual(weekLine(tap, api), ["1", String(RESET)]);
});
