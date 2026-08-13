import * as fs from "node:fs";
import * as path from "node:path";
import type { Page } from "playwright";
import { selectors } from "../selectors";
import type { Config, InvoiceExtraction } from "../types";
import { normalizePeriodo } from "../utils/date";
import { readInputValue, resolve, VerificationError } from "../utils/dom";

/** Anything smaller than this is an error page, not an invoice (plan F14). */
const MIN_PDF_BYTES = 1_000;
const PDF_MAGIC = "%PDF";

/**
 * Step 4: read the results, assert them against intent, and download the PDF.
 */
export async function extractResultsAndDownloadPDF(
  page: Page,
  config: Config,
  expected: { montoUYU: number; periodo: string }
): Promise<InvoiceExtraction> {
  console.log("📄 Step 4: Extracting invoice data and downloading PDF...");

  const paymentLink = await extractPaymentLink(page);

  // Plan F4: an unmatched regex used to leave `referencia` as "", which saved the file as
  // "FacturaBPS_.pdf" and printed SUCCESS with a blank reference and a broken payment link.
  const refMatch = /[?&]ref=(\d+)/.exec(paymentLink);
  if (!refMatch?.[1]) {
    throw new VerificationError(
      `Could not extract a reference number from the payment link: "${paymentLink}"`
    );
  }
  const referencia = refMatch[1];

  const montoConfirmado = await assertResultsMatchIntent(page, expected);

  const pdfPath = await downloadPDF(page, config, referencia);

  console.log("✅ Step 4 completed\n");
  return { referencia, paymentLink, pdfPath, montoConfirmado };
}

/**
 * The terminal check (plan A4).
 *
 * Every guard before this point protects the number on its way INTO the form. This one
 * reads back what BPS says it actually recorded. It is the single assertion that catches
 * every upstream failure mode at once — including ones we did not anticipate — which is
 * why it is worth more than any individual mid-flight check.
 */
async function assertResultsMatchIntent(
  page: Page,
  expected: { montoUYU: number; periodo: string }
): Promise<number> {
  const montoText = await readInputValue(page, selectors.step4.montoConfirmado);
  if (montoText === null) {
    throw new VerificationError(
      `Could not read the confirmed amount off the results page, so the invoice cannot be ` +
        `verified against what this run intended (${expected.montoUYU} UYU).\n` +
        `  Tried: ${selectors.step4.montoConfirmado.candidates.join(", ")}\n` +
        `  Fix: pin this selector from a captured page (docs/IMPROVEMENT_PLAN.md §7 item 11).`
    );
  }

  const montoConfirmado = Number(montoText.replace(/[^\d]/g, ""));
  if (montoConfirmado !== expected.montoUYU) {
    throw new VerificationError(
      `Invoice amount mismatch — BPS recorded ${montoConfirmado} UYU but this run intended ` +
        `${expected.montoUYU} UYU. The invoice has already been created; check it manually.`
    );
  }
  console.log(`   ✓ Confirmed amount matches intent: ${montoConfirmado} UYU`);

  const periodoText = await readInputValue(page, selectors.step4.periodo);
  if (periodoText && normalizePeriodo(periodoText) !== normalizePeriodo(expected.periodo)) {
    throw new VerificationError(
      `Período mismatch on the results page — BPS recorded "${periodoText}" but this run ` +
        `intended "${expected.periodo}". The invoice has already been created; check it manually.`
    );
  }

  return montoConfirmado;
}

async function extractPaymentLink(page: Page): Promise<string> {
  // Plan F8: `.first()` via the cascade (the original had no `.first()`, so two matches
  // meant a strict-mode throw), and the href is resolved to an ABSOLUTE URL — `getAttribute`
  // returns the raw attribute, which is unusable when BPS emits a relative href.
  const link = await resolve(page, selectors.step4.paymentLink);
  const href = await link.evaluate((element) => (element as HTMLAnchorElement).href);
  if (!href) {
    throw new VerificationError("The payment link has no href.");
  }
  return href;
}

async function downloadPDF(page: Page, config: Config, referencia: string): Promise<string> {
  const link = await resolve(page, selectors.step4.downloadLink);
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);

  fs.mkdirSync(config.outputDir, { recursive: true });

  const filePath = path.join(config.outputDir, `FacturaBPS_${referencia}.pdf`);
  await download.saveAs(filePath);

  await assertIsRealPdf(filePath);
  console.log(`   ✓ PDF saved: ${filePath}`);
  return filePath;
}

/** `download.saveAs()` succeeds for a 0-byte file or an HTML error page (plan F14). */
async function assertIsRealPdf(filePath: string): Promise<void> {
  const file = Bun.file(filePath);
  const size = file.size;
  if (size < MIN_PDF_BYTES) {
    throw new VerificationError(
      `Downloaded invoice is only ${size} bytes (expected at least ${MIN_PDF_BYTES}). ` +
        `BPS probably returned an error page instead of a PDF.`
    );
  }
  const header = await file.slice(0, PDF_MAGIC.length).text();
  if (header !== PDF_MAGIC) {
    throw new VerificationError(
      `Downloaded invoice is not a PDF — it starts with ${JSON.stringify(header)} ` +
        `instead of "${PDF_MAGIC}".`
    );
  }
}
