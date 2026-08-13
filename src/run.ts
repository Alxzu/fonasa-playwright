import * as fs from "node:fs";
import * as path from "node:path";
import type { Page } from "playwright";
import { extractResultsAndDownloadPDF, fillStep1, fillStep2, fillStep3 } from "./steps";
import type { Config, ExchangeRate, InvoiceResult } from "./types";
import { getExpectedPeriodo } from "./utils/date";
import { scrubHtml } from "./utils/dom";

/**
 * Share of the invoiced amount used as the base de cálculo (plan A7).
 *
 * OPEN QUESTION (plan §8.2): this was an unexplained `* 0.7` inline in main(). It is a
 * regime-dependent legal constant, so it belongs in one named place with a citation.
 * Confirm the basis before the next run.
 */
export const BASE_CALCULO_FACTOR = 0.7;

export interface RunDeps {
  today: Date;
  exchange: ExchangeRate;
}

export function computeAmounts(montoUSD: number, rate: number) {
  const montoUYU = Math.round(montoUSD * rate);
  const baseCalculo = Math.round(montoUYU * BASE_CALCULO_FACTOR);
  return { montoUYU, baseCalculo };
}

/** Where the machine-readable result for a período lives (plan F17, A6). */
export function resultPathForPeriodo(config: Config, periodo: string): string {
  return path.join(config.outputDir, `result_${periodo.replace("/", "-")}.json`);
}

/**
 * Refuse to generate a second real invoice for a período we already invoiced (plan A6).
 *
 * The whole danger model of this repo is that a successful run has legal side effects that
 * cannot be undone from code. "Don't run it twice" was previously enforced only by prose.
 */
export function assertNotAlreadyInvoiced(config: Config, periodo: string): void {
  if (config.force) return;
  const existing = resultPathForPeriodo(config, periodo);
  if (fs.existsSync(existing)) {
    const previous = JSON.parse(fs.readFileSync(existing, "utf8")) as InvoiceResult;
    throw new Error(
      `An invoice for período ${periodo} already exists (ref ${previous.referencia}, ` +
        `generated ${previous.generatedAt}).\n` +
        `  Record: ${existing}\n` +
        `  Running again would create a SECOND real invoice for the same month.\n` +
        `  If that is genuinely what you want, re-run with --force.`
    );
  }
}

/**
 * The whole pipeline, against whatever page it is handed (plan §4.3).
 *
 * Split out of main() so the mock-BPS end-to-end tests can drive it in-process instead of
 * spawning a subprocess and scraping stdout — and so any future caller (a webhook, a
 * skill) can use it directly.
 */
export async function runInvoice(
  page: Page,
  config: Config,
  deps: RunDeps
): Promise<InvoiceResult> {
  const { today, exchange } = deps;
  const { montoUYU, baseCalculo } = computeAmounts(config.montoUSD, exchange.rate);
  const expectedPeriodo = getExpectedPeriodo(today);

  assertNotAlreadyInvoiced(config, expectedPeriodo);

  console.log(
    `💱 Converting: $${config.montoUSD.toLocaleString()} USD × ${exchange.rate} = ${montoUYU.toLocaleString()} UYU`
  );
  console.log(`🗓️  Período: ${expectedPeriodo}\n`);

  await fillStep1(page, config);
  const periodo = await fillStep2(page, expectedPeriodo);
  const { fechaPago } = await fillStep3(page, config, montoUYU, baseCalculo, today);
  const extraction = await extractResultsAndDownloadPDF(page, config, {
    montoUYU,
    periodo: expectedPeriodo
  });

  const result: InvoiceResult = {
    referencia: extraction.referencia,
    montoUSD: config.montoUSD,
    exchangeRate: exchange.rate,
    exchangeDate: exchange.date,
    exchangeLeg: exchange.leg,
    montoUYU,
    baseCalculo,
    fechaPago,
    periodo,
    paymentLink: extraction.paymentLink,
    pdfPath: extraction.pdfPath,
    generatedAt: new Date().toISOString()
  };

  writeResult(config, result);
  return result;
}

/** Machine-readable output (plan F17) — also the record the double-run guard reads. */
export function writeResult(config: Config, result: InvoiceResult): string {
  fs.mkdirSync(config.outputDir, { recursive: true });
  const filePath = resultPathForPeriodo(config, result.periodo);
  fs.writeFileSync(filePath, `${JSON.stringify(result, null, 2)}\n`);
  return filePath;
}

/**
 * Capture everything needed to diagnose a failure without touching BPS again (plan F13).
 *
 * A screenshot shows what the page looked like; it does not show what the selectors could
 * have matched. The HTML and the trace do. Input values are blanked before writing,
 * because JSF re-renders echo documento/RUT/DOB into `value="…"` attributes on every
 * postback and these artifacts are read by tooling and agents later.
 */
export async function captureFailureArtifacts(
  page: Page,
  config: Config,
  error: Error
): Promise<string[]> {
  const written: string[] = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  try {
    fs.mkdirSync(config.outputDir, { recursive: true });

    // url() is safe on a closed page, but the outer catch would swallow a throw here and
    // cost us the log entirely, so guard it.
    let url = "(unavailable)";
    try {
      url = page.url();
    } catch {
      // Keep the placeholder.
    }

    // Write the details FIRST: screenshot() and content() both throw once the page is
    // closed or has crashed, which is exactly when these details matter most.
    const notePath = path.join(config.outputDir, `error_${stamp}.txt`);
    fs.writeFileSync(
      notePath,
      [
        `Timestamp: ${new Date().toISOString()}`,
        `URL:       ${url}`,
        `Error:     ${error.name}: ${error.message}`,
        "",
        error.stack ?? "(no stack trace available)",
        ""
      ].join("\n")
    );
    written.push(notePath);

    const screenshot = path.join(config.outputDir, `error_${stamp}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    written.push(screenshot);

    const htmlPath = path.join(config.outputDir, `error_${stamp}.html`);
    fs.writeFileSync(htmlPath, await scrubHtml(await page.content()));
    written.push(htmlPath);
  } catch {
    // Artifact capture must never mask the original failure.
  }

  // Separate try: the trace is the single most useful artifact, so a failed screenshot
  // (closed page) must not cost us it.
  try {
    const tracePath = path.join(config.outputDir, `trace_${stamp}.zip`);
    await page.context().tracing.stop({ path: tracePath });
    written.push(tracePath);
  } catch {
    // Tracing may not have been started.
  }

  return written;
}
