import * as fs from "node:fs";
import * as path from "node:path";
import type { Page } from "playwright";
import { config } from "../config";
import type { InvoiceExtraction } from "../types";

/**
 * Step 4: Extract results and download PDF
 */
export async function extractResultsAndDownloadPDF(page: Page): Promise<InvoiceExtraction> {
  console.log("📄 Step 4: Extracting invoice data and downloading PDF...");

  // Wait for results page to load
  await page.waitForTimeout(1000);

  const paymentLink = await extractPaymentLink(page);

  // Extract reference number from payment link
  let referencia = "";
  const refMatch = paymentLink.match(/ref=(\d+)/);
  if (refMatch) {
    referencia = refMatch[1];
  }

  const pdfPath = await downloadPDF(page, referencia);

  console.log("✅ Step 4 completed\n");

  return {
    referencia,
    paymentLink,
    pdfPath,
  };
}

async function extractPaymentLink(page: Page): Promise<string> {
  return (await page.locator('a:has-text("Pagar Factura")').getAttribute("href")) || "";
}

async function downloadPDF(page: Page, referencia: string): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Imprimir o Descargar Factura" }).click(),
  ]);

  // Ensure output directory exists
  if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true });
  }

  const fileName = `FacturaBPS_${referencia}.pdf`;
  const filePath = path.join(config.outputDir, fileName);
  await download.saveAs(filePath);

  return filePath;
}
