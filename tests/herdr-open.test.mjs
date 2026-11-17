import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BUILD = fileURLToPath(new URL("../tools/herdr-open/build.sh", import.meta.url));
const EXTENSIONS = "md sql py ts js json yaml yml sh".split(" ");

// Every tool build.sh touches, stubbed: none of them may reach the real system or default apps.
function stub(name, body) {
  const path = join(process.env.STUB_BIN, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

function setup(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const bins = join(root, "stubs");
  mkdirSync(bins);
  process.env.STUB_BIN = bins;
  stub("swiftc", `
out=
prev=
for a in "$@"; do
  [ "$prev" = "-o" ] && out=$a
  prev=$a
done
printf '%s\\n' '#!/bin/sh' 'if [ "$1" = "--print" ]; then shift; app=$1; shift; for ext in "$@"; do printf "%s\\t%s\\n" "$ext" /Applications/Old.app; done; exit 0; fi' 'exit 0' > "$out"
chmod +x "$out"
`);
  stub("osacompile", 'mkdir -p "$2/Contents"; : > "$2/Contents/Info.plist"; cp "$3" "$OPEN_CAPTURE"');
  stub("codesign", "exit 0");
  stub("lsregister", "exit 0");
  stub("PlistBuddy", "exit 0");
  const home = join(root, "home");
  const appHome = join(root, "app-home");
  mkdirSync(home);
  mkdirSync(join(appHome, "mods", "night-city-editor"), { recursive: true });
  const launcher = join(appHome, "mods", "night-city-editor", "hv-open");
  writeFileSync(launcher, "#!/bin/sh\n");
  chmodSync(launcher, 0o755);

  const env = {
    ...process.env,
    HOME: home,
    HERDR_APP_HOME: appHome,
    XDG_STATE_HOME: join(root, "state"),
    TMPDIR: join(root, "tmp"),
    PATH: `${bins}:${process.env.PATH}`,
    HERDR_LSREGISTER: join(bins, "lsregister"),
    HERDR_PLISTBUDDY: join(bins, "PlistBuddy"),
    OPEN_CAPTURE: join(root, "compiled.applescript"),
  };
  mkdirSync(env.TMPDIR);
  return { root, home, appHome, env, capture: env.OPEN_CAPTURE };
}

const run = (args, env) => spawnSync("sh", [BUILD, ...args], { env, encoding: "utf8" });

test("build.sh bakes the mod id into the applet and records the previous apps", () => {
  const { root, home, env, capture } = setup("herdr-open-");
  try {
    const r = run(["--mod", "night-city-editor"], env);
    assert.equal(r.status, 0, r.stderr);

    const app = join(home, "Applications", "Herdr Open.app");
    assert.ok(existsSync(app), "the app is built under the temp HOME");
    const script = readFileSync(capture, "utf8");
    assert.match(script, /mods\/night-city-editor\/hv-open/);
    assert.doesNotMatch(script, /@MOD@/);

    const recorded = readFileSync(join(root, "state", "herdr-tower", "open-previous.tsv"), "utf8");
    for (const ext of EXTENSIONS) assert.match(recorded, new RegExp(`^${ext}\\t/Applications/Old\\.app$`, "m"), ext);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("build.sh honours HERDR_APP_HOME for the launcher it requires", () => {
  const { root, env, capture } = setup("herdr-open-path-");
  try {
    const r = run(["--mod", "missing-editor"], env);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /mods\/missing-editor\/hv-open is missing/);
    assert.equal(existsSync(capture), false, "nothing is compiled without a launcher");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("build.sh refuses a missing or unusable --mod", () => {
  const { root, env } = setup("herdr-open-usage-");
  try {
    const none = run([], env);
    assert.equal(none.status, 2);
    assert.match(none.stderr, /usage: build\.sh --mod <editor-mod-id>/);
    const bad = run(["--mod", "../night-city-editor"], env);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /is not a mod id/);
    const unknown = run(["--nonsense"], env);
    assert.equal(unknown.status, 2);
    assert.match(unknown.stderr, /unknown argument/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--restore gives back the recorded apps without building the app", () => {
  const { root, home, env, capture } = setup("herdr-open-restore-");
  try {
    const first = run(["--mod", "night-city-editor"], env);
    assert.equal(first.status, 0, first.stderr);
    rmSync(join(home, "Applications", "Herdr Open.app"), { recursive: true, force: true });
    rmSync(capture);

    const r = run(["--restore"], env);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(capture), false, "restore does not compile anything");
    assert.equal(existsSync(join(home, "Applications", "Herdr Open.app")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
