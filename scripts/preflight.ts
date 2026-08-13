/**
 * Preflight check (plan A9).
 *
 * `bunx playwright install chromium` exits 0 even when it downloads nothing (e.g. no
 * network egress), so a missing browser surfaces much later as Playwright's opaque
 * "Executable doesn't exist at .../chrome-headless-shell". This fails early and says why.
 */
import { chromium } from "playwright";

const pkg = (await Bun.file("package.json").json()) as {
  dependencies?: Record<string, string>;
};
const pinned = pkg.dependencies?.playwright ?? "(unset)";

if (/^[\^~]/.test(pinned)) {
  console.warn(
    `⚠️  playwright is range-pinned as "${pinned}". A lockfile refresh can resolve to a\n` +
      `   newer Playwright that requires a browser build you do not have installed.\n` +
      `   Pin it exactly (plan A9).`
  );
}

try {
  const browser = await chromium.launch();
  const version = browser.version();
  await browser.close();
  console.log(`✅ Preflight OK — playwright ${pinned}, chromium ${version}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `❌ Preflight failed: no usable Chromium for playwright ${pinned}.\n\n` +
      `   ${message.split("\n")[0]}\n\n` +
      `   Fix: bun run install:browser\n` +
      `   If that exits 0 but changes nothing, your network is blocking the download —\n` +
      `   the browser-based test tiers (test/selectors, test/e2e) cannot run until it succeeds.`
  );
  process.exitCode = 1;
}
