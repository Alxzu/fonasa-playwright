import { chromium } from "playwright";
import { parseCliArgs, USAGE } from "./cli";
import { loadConfig, validateConfig } from "./config";
import { captureFailureArtifacts, computeAmounts, resultPathForPeriodo, runInvoice } from "./run";
import type { InvoiceResult } from "./types";
import { getExpectedPeriodo } from "./utils/date";
import { getExchangeRate } from "./utils/exchange-rate";

function printSummary(result: InvoiceResult): void {
  const line = "═".repeat(63);
  console.log(line);
  console.log("              📋 INVOICE GENERATED SUCCESSFULLY");
  console.log(`${line}\n`);
  console.log(`  📌 Reference Number:    ${result.referencia}`);
  console.log(`  🗓️  Período:             ${result.periodo}`);
  console.log(`  💵 Amount Invoiced:     $${result.montoUSD.toLocaleString()} USD`);
  console.log(
    `  💱 Exchange Rate:       ${result.exchangeRate} (${result.exchangeDate}, ${result.exchangeLeg})`
  );
  console.log(`  💰 Amount in UYU:       ${result.montoUYU.toLocaleString()} UYU`);
  console.log(`  📊 Base de cálculo:     ${result.baseCalculo.toLocaleString()} UYU (70%)`);
  console.log(`  📆 Payment Date:        ${result.fechaPago ?? "NOT SET — verify on the PDF"}`);
  console.log(`  📁 PDF Location:        ${result.pdfPath}`);
  console.log(`\n  🔗 Payment Link:\n     ${result.paymentLink}\n`);
  console.log(`${line}\n`);
}

async function main(): Promise<void> {
  const options = parseCliArgs(Bun.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }

  const config = loadConfig(process.env, options);
  for (const warning of validateConfig(config)) console.warn(`⚠️  ${warning}`);

  const today = new Date();
  const exchange = await getExchangeRate({
    api: config.exchangeRateAPI,
    today,
    fetch: globalThis.fetch,
    log: (message) => console.log(message)
  });

  if (config.dryRun) {
    const { montoUYU, baseCalculo } = computeAmounts(config.montoUSD, exchange.rate);
    const periodo = getExpectedPeriodo(today);
    console.log(
      `\n🧪 Dry run — no browser, no invoice.\n` +
        `   Período:         ${periodo}\n` +
        `   Rate:            ${exchange.rate} (${exchange.date}, ${exchange.leg})\n` +
        `   Monto:           ${montoUYU.toLocaleString()} UYU\n` +
        `   Base de cálculo: ${baseCalculo.toLocaleString()} UYU\n` +
        `   Would write:     ${resultPathForPeriodo(config, periodo)}\n`
    );
    return;
  }

  const browser = await chromium.launch({ headless: config.headless });
  const context = await browser.newContext({ acceptDownloads: true });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();

  try {
    console.log("🚀 Starting BPS FONASA form automation...\n");
    const result = await runInvoice(page, config, { today, exchange });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printSummary(result);
    }
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : error);
    const artifacts = await captureFailureArtifacts(page, config, error as Error);
    if (artifacts.length > 0) {
      console.error(`\n🔍 Debug artifacts written:`);
      for (const file of artifacts) console.error(`   ${file}`);
      console.error(`   Inspect the trace with: bunx playwright show-trace <trace_*.zip>\n`);
    }
    throw error;
  } finally {
    await browser.close();
  }
}

// Plan F21: no process.exit(0) on success — it can truncate pending stdout writes.
// Let the process end naturally; only a failure sets a non-zero exit code.
main().catch((error) => {
  console.error("💥 Process failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
