import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// The names to keep out live outside the repo, so this public file does not spell them out.
const LIST = process.env.HERDR_PRIVATE_NAMES
  || join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "herdr-shared", "private-names.txt");
const patterns = existsSync(LIST)
  ? readFileSync(LIST, "utf8").split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"))
  : [];

test("no tracked file names anything on the local private-names list", { skip: patterns.length ? false : `no list at ${LIST}` }, () => {
  const deny = new RegExp(patterns.join("|"), "i");
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
  assert.ok(files.length > 0, "git ls-files found no files to inspect");
  const found = [];
  for (const file of files) {
    readFileSync(join(ROOT, file), "utf8").split("\n").forEach((line, index) => {
      if (deny.test(line)) found.push(`${file}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(found, []);
});
