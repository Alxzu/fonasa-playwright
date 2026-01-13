import * as fs from "fs";
import * as path from "path";
import { chromium, type Page } from "playwright";
import { config, validateConfig } from "./config";
import { fillStep1, fillStep2, fillStep3, extractResultsAndDownloadPDF } from "./steps";
import type { InvoiceResult } from "./types";
import { getExchangeRate } from "./utils";

/**
 * Save a screenshot on failure for debugging
 */
async function saveErrorScreenshot(page: Page, error: Error): Promise<void> {
  try {
    if (!fs.existsSync(config.outputDir)) {
      fs.mkdirSync(config.outputDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const screenshotPath = path.join(config.outputDir, `error_${timestamp}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.error(`📸 Screenshot saved: ${screenshotPath}`);
  } catch {
    // Ignore screenshot errors
  }
}

/**
 * Print summary of the generated invoice
 */
function printSummary(result: InvoiceResult): void {
  console.log(
    "═══════════════════════════════════════════════════════════════"
  );
  console.log("              📋 INVOICE GENERATED SUCCESSFULLY");
  console.log(
    "═══════════════════════════════════════════════════════════════\n"
  );
  console.log(`  📌 Reference Number:    ${result.referencia}`);
  console.log(
    `  💵 Amount Invoiced:     $${result.montoUSD.toLocaleString()} USD`
  );
  console.log(
    `  💱 Exchange Rate:       ${result.exchangeRate} (${result.exchangeDate})`
  );
  console.log(
    `  💰 Amount in UYU:       ${result.montoUYU.toLocaleString()} UYU`
  );
  console.log(
    `  📊 Base de cálculo:     ${result.baseCalculo.toLocaleString()} UYU (70%)`
  );
  console.log(`  📆 Payment Date:        ${result.fechaPago}`);
  console.log(`  📁 PDF Location:        ${result.pdfPath}`);
  console.log(`\n  🔗 Payment Link:`);
  console.log(`     ${result.paymentLink}\n`);
  console.log(
    "═══════════════════════════════════════════════════════════════\n"
  );
}

/**
 * Main function - orchestrates the entire invoice generation process
 */
async function main(): Promise<InvoiceResult> {
  // Validate configuration
  validateConfig();

  // Get exchange rate from BCU
  const exchange = await getExchangeRate();
  const montoUYU = Math.round(config.montoUSD * exchange.rate);
  const baseCalculo = Math.round(montoUYU * 0.7);

  console.log(
    `💱 Converting: $${config.montoUSD.toLocaleString()} USD × ${exchange.rate} = ${montoUYU.toLocaleString()} UYU\n`
  );

  // Launch browser
  const browser = await chromium.launch({ headless: config.headless });
  const context = await browser.newContext({
    acceptDownloads: true,
  });
  const page = await context.newPage();

  try {
    console.log("🚀 Starting BPS FONASA form automation...\n");

    // Execute form steps
    await fillStep1(page);
    await fillStep2(page);
    const fechaPago = await fillStep3(page, montoUYU, baseCalculo);
    const extraction = await extractResultsAndDownloadPDF(page);

    // Build result
    const result: InvoiceResult = {
      referencia: extraction.referencia,
      montoUSD: config.montoUSD,
      exchangeRate: exchange.rate,
      exchangeDate: exchange.date,
      montoUYU,
      baseCalculo,
      fechaPago,
      paymentLink: extraction.paymentLink,
      pdfPath: extraction.pdfPath,
    };

    printSummary(result);

    return result;
  } catch (error) {
    console.error("❌ Error:", error);
    await saveErrorScreenshot(page, error as Error);
    throw error;
  } finally {
    await browser.close();
  }
}

// Run
main()
  .then(() => {
    console.log("🎉 Process completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Process failed:", error);
    process.exit(1);
  });
