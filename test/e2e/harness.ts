import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type Browser, chromium } from "playwright";
import { loadConfig } from "../../src/config";
import { captureFailureArtifacts, runInvoice } from "../../src/run";
import type { Config, ExchangeRate, InvoiceResult } from "../../src/types";
import type { Scenario } from "../mock-bps/scenarios";
import { type MockServer, startMockBps } from "../mock-bps/server";

/** Fixed clock: 12 Aug 2026 → the expected período is 07/2026. */
export const TODAY = new Date(2026, 7, 12);
export const EXPECTED_PERIODO = "07/2026";

export const EXCHANGE: ExchangeRate = { rate: 40, date: "2026-07-31", leg: "sell" };
export const MONTO_USD = 1000;
export const EXPECTED_UYU = 40_000; // 1000 × 40
export const EXPECTED_BASE = 28_000; // 70 % of 40 000

const BASE_ENV = {
  BPS_EMPRESA: "1234567",
  BPS_RUT: "123456789012",
  BPS_DOCUMENTO: "11111111",
  BPS_FECHA_NAC: "17/07/1990",
  BPS_MONTO_USD: String(MONTO_USD)
};

/**
 * ONE browser and ONE mock server per test file, with a fresh browser CONTEXT per run.
 *
 * This is not just an optimisation. Repeatedly calling `chromium.launch()` inside a single
 * Bun process reliably wedges after a handful of launches — the process stops making
 * progress with no error, and whichever test happens to be running times out (so the
 * "failing" test moves around between runs, which is what makes it look like flakiness in
 * the code under test rather than in the harness).
 *
 * A fresh context gives the same isolation a fresh browser would (separate cookie jar, so
 * separate mock-BPS session) at ~50ms instead of ~1s, and does not wedge.
 *
 * The browser and mock are per-HARNESS, deliberately NOT module-level singletons: bun test
 * loads every test file into one process, so shared mutable state means one file's
 * `afterAll` can tear down a browser another file is still using — which shows up as
 * unrelated tests timing out. Each file owns its own harness instead.
 *
 * That is only half the invariant. The other half — one FILE per process, so one launch per
 * process — is enforced by `scripts/run-e2e.ts`, because the wedge threshold is as low as
 * two launches on a 2-core CI runner. Do not run `bun test test/e2e` directly; use
 * `bun run test:e2e`.
 */
export interface Harness {
  run: typeof runAgainstMock;
  close: () => Promise<void>;
}

/** Create in `beforeAll`, close in `afterAll`. One browser + one mock per test file. */
export async function createHarness(): Promise<Harness> {
  const browser = await chromium.launch();
  const mock = startMockBps({ today: TODAY });

  return {
    run: (scenario, options) => runAgainstMock(scenario, options, { browser, mock }),
    close: async () => {
      await browser.close();
      await mock.stop();
    }
  };
}

export interface RunOutcome {
  result?: InvoiceResult;
  error?: Error;
  config: Config;
  outputDir: string;
  submission: Record<string, string>;
  /** Paths written by captureFailureArtifacts, when `captureArtifacts` was requested. */
  artifacts: string[];
}

/** Drive the real pipeline against the mock BPS, in-process (plan §4.3). */
export async function runAgainstMock(
  scenario: Scenario,
  options: {
    envOverrides?: Record<string, string>;
    force?: boolean;
    /** Reuse a previous run's directory — needed to exercise the double-run guard. */
    outputDir?: string;
    /** Start tracing and write failure artifacts, to exercise the F13 capture path. */
    captureArtifacts?: boolean;
  } = {},
  deps?: { browser: Browser; mock: MockServer }
): Promise<RunOutcome> {
  if (!deps) throw new Error("runAgainstMock must be called through createHarness()");
  const outputDir = options.outputDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "fonasa-e2e-"));
  const server = deps.mock;
  const context = await deps.browser.newContext({ acceptDownloads: true });
  if (options.captureArtifacts) {
    await context.tracing.start({ screenshots: true, snapshots: true });
  }

  try {
    const page = await context.newPage();
    const config = loadConfig(
      {
        ...BASE_ENV,
        ...options.envOverrides,
        BPS_FORM_URL: `${server.url}?scenario=${scenario}`,
        OUTPUT_DIR: outputDir
      },
      { force: options.force ?? false }
    );

    try {
      const result = await runInvoice(page, config, { today: TODAY, exchange: EXCHANGE });
      return { result, config, outputDir, submission: server.lastSubmission(), artifacts: [] };
    } catch (error) {
      const artifacts = options.captureArtifacts
        ? await captureFailureArtifacts(page, config, error as Error)
        : [];
      return {
        error: error as Error,
        config,
        outputDir,
        submission: server.lastSubmission(),
        artifacts
      };
    }
  } finally {
    await context.close();
  }
}

export function cleanup(outputDir: string): void {
  fs.rmSync(outputDir, { recursive: true, force: true });
}
