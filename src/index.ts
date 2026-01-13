import { chromium, type Page } from "playwright";
import path from "path";

// Load environment variables
const CONFIG = {
  // Company Data
  empresa: process.env.BPS_EMPRESA || "",
  rut: process.env.BPS_RUT || "",

  // Holder Data
  documento: process.env.BPS_DOCUMENTO || "",
  fechaNacimiento: {
    day: process.env.BPS_FECHA_NAC_DIA || "",
    month: process.env.BPS_FECHA_NAC_MES || "", // Ene, Feb, Mar, Abr, May, Jun, Jul, Ago, Sep, Oct, Nov, Dic
    year: process.env.BPS_FECHA_NAC_ANIO || "",
  },

  // Invoice Settings
  impuesto: process.env.BPS_IMPUESTO || "IRPF", // IRPF, IRAE, IRPF e IRAE

  // Amount in USD (will be converted to UYU)
  montoUSD: Number(process.env.BPS_MONTO_USD) || 0,

  // Exchange rate API
  exchangeRateAPI:
    process.env.EXCHANGE_RATE_API || "https://bcu.alxzu.duckdns.org/usd-rate",

  // Output
  outputDir: process.env.OUTPUT_DIR || "./output",

  // Browser settings
  headless: process.env.HEADLESS !== "false",
};

interface ExchangeRateResponse {
  buyRate: number;
  sellRate: number;
  date: string;
}

interface InvoiceResult {
  referencia: string;
  montoUSD: number;
  exchangeRate: number;
  exchangeDate: string;
  montoUYU: number;
  baseCalculo: number;
  importe: string;
  fechaPago: string;
  vencimiento: string;
  paymentLink: string;
  pdfPath: string;
}

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date: Date): string {
  return date.toISOString().split("T")[0] as string;
}

/**
 * Go back to previous business day (skip weekends)
 */
function getPreviousBusinessDay(date: Date): Date {
  const newDate = new Date(date);
  newDate.setDate(newDate.getDate() - 1);

  // Skip weekends
  const dayOfWeek = newDate.getDay();
  if (dayOfWeek === 0) {
    newDate.setDate(newDate.getDate() - 2); // Sunday -> Friday
  } else if (dayOfWeek === 6) {
    newDate.setDate(newDate.getDate() - 1); // Saturday -> Friday
  }

  return newDate;
}

/**
 * Get the last day of the previous month (adjusted for weekends)
 */
function getLastDayOfPreviousMonth(): Date {
  const today = new Date();
  // Go to last day of previous month
  const lastDay = new Date(today.getFullYear(), today.getMonth(), 0);

  // If it's a weekend, go back to Friday
  const dayOfWeek = lastDay.getDay();
  if (dayOfWeek === 0) {
    lastDay.setDate(lastDay.getDate() - 2); // Sunday -> Friday
  } else if (dayOfWeek === 6) {
    lastDay.setDate(lastDay.getDate() - 1); // Saturday -> Friday
  }

  return lastDay;
}

/**
 * Fetch USD exchange rate from BCU API
 * Retries with previous business days if the date is a holiday (404)
 */
async function getExchangeRate(): Promise<{ rate: number; date: string }> {
  const MAX_RETRIES = 10; // Max days to go back (in case of consecutive holidays)
  let currentDate = getLastDayOfPreviousMonth();

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const dateStr = formatDate(currentDate);
    const url = `${CONFIG.exchangeRateAPI}?date=${dateStr}`;

    console.log(`📊 Fetching exchange rate for ${dateStr}...`);

    const response = await fetch(url);

    if (response.ok) {
      const data = (await response.json()) as ExchangeRateResponse;
      console.log(`   ✅ Rate: ${data.sellRate} UYU/USD\n`);

      return {
        rate: data.sellRate,
        date: dateStr,
      };
    }

    if (response.status === 404) {
      console.log(`   ⚠️  No rate available (holiday?), trying previous day...`);
      currentDate = getPreviousBusinessDay(currentDate);
      continue;
    }

    // Other errors should throw
    throw new Error(`Failed to fetch exchange rate: ${response.status} for date ${dateStr}`);
  }

  throw new Error(`Could not find exchange rate after ${MAX_RETRIES} attempts`);
}

/**
 * Validate configuration
 */
function validateConfig(): void {
  const required = [
    { key: "empresa", value: CONFIG.empresa },
    { key: "rut", value: CONFIG.rut },
    { key: "documento", value: CONFIG.documento },
    { key: "fechaNacimiento.day", value: CONFIG.fechaNacimiento.day },
    { key: "fechaNacimiento.month", value: CONFIG.fechaNacimiento.month },
    { key: "fechaNacimiento.year", value: CONFIG.fechaNacimiento.year },
    { key: "montoUSD", value: CONFIG.montoUSD },
  ];

  const missing = required.filter((r) => !r.value);
  if (missing.length > 0) {
    throw new Error(
      `Missing required configuration: ${missing.map((m) => m.key).join(", ")}\n` +
      `Please check your .env file.`
    );
  }
}

/**
 * Fill Step 1: Datos del Titular
 */
async function fillStep1(page: Page): Promise<void> {
  console.log("📄 Step 1: Navigating to form and filling holder data...");

  await page.goto(
    "https://app1.bps.gub.uy/SnisProfesionalesWeb/paginas/anticipos/snisAnticiposAInicio.jsf"
  );
  await page.waitForLoadState("networkidle");

  // Fill company data
  await page.getByRole("textbox", { name: "empresa" }).fill(CONFIG.empresa);
  await page.getByRole("textbox", { name: "rut" }).fill(CONFIG.rut);

  // Fill holder data
  await page.getByRole("textbox", { name: "Documento" }).fill(CONFIG.documento);

  // Use calendar for date of birth
  await page.getByRole("link", { name: "calendario" }).click();
  await page.waitForTimeout(500);

  // Select year
  await page
    .locator("div.calendarBody select")
    .nth(1)
    .selectOption(CONFIG.fechaNacimiento.year);
  await page.waitForTimeout(300);

  // Select month
  await page
    .locator("div.calendarBody select")
    .nth(0)
    .selectOption(CONFIG.fechaNacimiento.month);
  await page.waitForTimeout(300);

  // Click day
  await page
    .getByRole("link", { name: CONFIG.fechaNacimiento.day, exact: true })
    .click();
  await page.waitForTimeout(500);

  // Click Next
  await page.getByRole("link", { name: "Siguiente >" }).click();
  await page.waitForLoadState("networkidle");

  console.log("✅ Step 1 completed\n");
}

/**
 * Fill Step 2: Tipo Factura
 */
async function fillStep2(page: Page): Promise<void> {
  console.log("📄 Step 2: Selecting invoice type...");

  // Default "Anticipos mensuales" is already selected
  // Period defaults are also pre-filled

  await page.getByRole("link", { name: "Siguiente >" }).click();
  await page.waitForLoadState("networkidle");

  console.log("✅ Step 2 completed\n");
}

/**
 * Fill Step 3: Datos Factura
 */
async function fillStep3(
  page: Page,
  montoUYU: number,
  baseCalculo: number
): Promise<string> {
  console.log("📄 Step 3: Filling invoice data...");

  // Select tax type
  await page
    .locator('[id="frmBasico:impuesto"]')
    .selectOption(CONFIG.impuesto);
  await page.waitForTimeout(500);

  // Fill amount
  console.log(`   Monto facturado sin IVA: ${montoUYU.toLocaleString()} UYU`);
  await page
    .locator('input[name="frmBasico:rptLineasPROF:0:j_id46"]')
    .fill(montoUYU.toString());
  await page.waitForTimeout(300);

  // Fill "Base de cálculo" as 70% of "Monto facturado sin IVA"
  console.log(`   Base de cálculo (70%): ${baseCalculo.toLocaleString()} UYU`);
  await page.getByAltText("_1profImporte").fill(baseCalculo.toString());
  await page.waitForTimeout(300);

  // Fill payment date with today's date using calendar picker
  const today = new Date();
  const fechaPago = `${String(today.getDate()).padStart(2, "0")}/${String(today.getMonth() + 1).padStart(2, "0")}/${today.getFullYear()}`;
  console.log(`   Setting payment date: ${fechaPago}`);

  // Click calendar icon to open date picker
  await page
    .locator('table:has-text("Fecha de pago") a:has(img[alt="calendario"])')
    .click();
  await page.waitForTimeout(500);

  // Click on today's day number
  await page
    .getByRole("link", { name: String(today.getDate()), exact: true })
    .click();
  await page.waitForTimeout(300);

  // Confirm
  await page.getByRole("link", { name: "Confirmar Anticipos FONASA" }).click();
  await page.waitForLoadState("networkidle");

  console.log("✅ Step 3 completed\n");

  return fechaPago;
}

/**
 * Extract results and download PDF (Step 4)
 */
async function extractResultsAndDownloadPDF(
  page: Page
): Promise<{
  referencia: string;
  importe: string;
  vencimiento: string;
  paymentLink: string;
  pdfPath: string;
}> {
  console.log("📄 Step 4: Extracting invoice data and downloading PDF...");

  // Extract invoice data
  const referenciaCell = await page
    .locator('tr:has-text("Nº Referencia") td')
    .nth(1)
    .textContent();
  const referencia = referenciaCell?.trim() || "";

  const importe =
    (await page
      .locator('tr:has-text("Importe a Pagar") td strong')
      .textContent()) || "";
  const vencimiento =
    (await page
      .locator('tr:has-text("Vencimiento") td strong')
      .textContent()) || "";
  const paymentLink =
    (await page
      .locator('a:has-text("Pagar Factura")')
      .getAttribute("href")) || "";

  // Download PDF
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Imprimir o Descargar Factura" }).click(),
  ]);

  // Ensure output directory exists
  const fs = await import("fs");
  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  }

  const fileName = `FacturaBPS_${referencia}.pdf`;
  const filePath = path.join(CONFIG.outputDir, fileName);
  await download.saveAs(filePath);

  console.log("✅ Step 4 completed\n");

  return {
    referencia,
    importe,
    vencimiento,
    paymentLink,
    pdfPath: filePath,
  };
}

/**
 * Print summary
 */
function printSummary(result: InvoiceResult): void {
  console.log(
    "═══════════════════════════════════════════════════════════════"
  );
  console.log(
    "              📋 INVOICE GENERATED SUCCESSFULLY"
  );
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
  console.log(`  🧾 Amount to Pay:       ${result.importe} UYU`);
  console.log(`  📆 Payment Date:        ${result.fechaPago}`);
  console.log(`  📅 Due Date:            ${result.vencimiento}`);
  console.log(`  📁 PDF Location:        ${result.pdfPath}`);
  console.log(`\n  🔗 Payment Link:`);
  console.log(`     ${result.paymentLink}\n`);
  console.log(
    "═══════════════════════════════════════════════════════════════\n"
  );
}

/**
 * Main function
 */
async function main(): Promise<InvoiceResult> {
  // Validate configuration
  validateConfig();

  // Get exchange rate
  const exchange = await getExchangeRate();
  const montoUYU = Math.round(CONFIG.montoUSD * exchange.rate);
  const baseCalculo = Math.round(montoUYU * 0.7);

  console.log(
    `💱 Converting: $${CONFIG.montoUSD.toLocaleString()} USD × ${exchange.rate} = ${montoUYU.toLocaleString()} UYU\n`
  );

  const browser = await chromium.launch({ headless: CONFIG.headless });
  const context = await browser.newContext({
    acceptDownloads: true,
  });
  const page = await context.newPage();

  try {
    console.log("🚀 Starting BPS FONASA form automation...\n");

    await fillStep1(page);
    await fillStep2(page);
    const fechaPago = await fillStep3(page, montoUYU, baseCalculo);
    const { referencia, importe, vencimiento, paymentLink, pdfPath } =
      await extractResultsAndDownloadPDF(page);

    const result: InvoiceResult = {
      referencia,
      montoUSD: CONFIG.montoUSD,
      exchangeRate: exchange.rate,
      exchangeDate: exchange.date,
      montoUYU,
      baseCalculo,
      importe,
      fechaPago,
      vencimiento,
      paymentLink,
      pdfPath,
    };

    printSummary(result);

    return result;
  } catch (error) {
    console.error("❌ Error:", error);
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
