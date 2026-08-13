/**
 * Run each end-to-end test file in its OWN bun process.
 *
 * Why this exists (plan A11): more than one `chromium.launch()` in a single Bun process
 * wedges — the process silently stops making progress and every subsequent test times out.
 * The threshold is machine-dependent: ~4 launches on an 8-core laptop, but as few as 2 on a
 * 2-core CI runner, where the whole suite passed locally and then hung in CI from the
 * second file onward.
 *
 * Each test file already keeps itself to one launch (see test/e2e/harness.ts). This script
 * guarantees the other half of the invariant: one file per process, so one launch per
 * process, regardless of how many e2e files exist.
 *
 * Globbed rather than hardcoded so adding a file cannot silently reintroduce the problem.
 */
const files = [...new Bun.Glob("*.test.ts").scanSync({ cwd: "test/e2e" })]
  .sort()
  .map((name) => `test/e2e/${name}`);

if (files.length === 0) {
  console.error("No e2e test files found in test/e2e/");
  process.exit(1);
}

let failed = false;
for (const file of files) {
  console.log(`\n──────── ${file} ────────`);
  const proc = Bun.spawnSync(["bun", "test", file], { stdout: "inherit", stderr: "inherit" });
  if (proc.exitCode !== 0) failed = true;
}

if (failed) {
  console.error("\n❌ e2e failures — see above.");
  process.exit(1);
}
console.log(`\n✅ ${files.length} e2e file(s) passed.`);
