import type { Page } from "playwright";
import { config } from "../config";
import { formatDateES } from "../utils/date";

/**
 * Step 3: Datos Factura
 * Fill invoice amounts and payment date
 */
export async function fillStep3(
  page: Page,
  montoUYU: number,
  baseCalculo: number
): Promise<string> {
  console.log("📄 Step 3: Filling invoice data...");

  // Wait for page to be ready
  await page.waitForTimeout(1000);

  await fillTaxType(page);
  await fillAmount(page, montoUYU);
  await fillBaseCalculo(page, baseCalculo);
  const fechaPago = await fillPaymentDate(page);
  await confirmStep(page);

  console.log("✅ Step 3 completed\n");

  return fechaPago;
}

async function fillTaxType(page: Page): Promise<void> {
  const impuestoSelect = page.locator('select[id*="impuesto"], select[name*="impuesto"]').first();
  if ((await impuestoSelect.count()) > 0) {
    await impuestoSelect.selectOption(config.impuesto);
  } else {
    console.log("   ⚠️ Tax select not found, skipping...");
  }
  await page.waitForTimeout(500);
}

async function fillAmount(page: Page, montoUYU: number): Promise<void> {
  const montoInput = page
    .locator('input[name*="j_id46"], input[id*="monto"], input[name*="monto"]')
    .first();
  if ((await montoInput.count()) > 0) {
    await montoInput.fill(montoUYU.toString());
  } else {
    // Try finding by table row label
    const montoRow = page
      .locator('tr:has-text("Monto facturado") input, tr:has-text("Monto") input')
      .first();
    if ((await montoRow.count()) > 0) {
      await montoRow.fill(montoUYU.toString());
    }
  }
  await page.waitForTimeout(300);
}

async function fillBaseCalculo(page: Page, baseCalculo: number): Promise<void> {
  const baseInput = page
    .locator('input[alt*="profImporte"], input[id*="base"], input[name*="base"]')
    .first();
  if ((await baseInput.count()) > 0) {
    await baseInput.fill(baseCalculo.toString());
  } else {
    // Try finding by table row label
    const baseRow = page
      .locator('tr:has-text("Base de cálculo") input, tr:has-text("Base") input')
      .first();
    if ((await baseRow.count()) > 0) {
      await baseRow.fill(baseCalculo.toString());
    }
  }
  await page.waitForTimeout(300);
}

async function fillPaymentDate(page: Page): Promise<string> {
  const today = new Date();
  const fechaPago = formatDateES(today);

  // Try to find and click calendar icon for payment date
  try {
    const calendarIcon = page.locator('img[alt="calendario"]').last();
    if ((await calendarIcon.count()) > 0) {
      await calendarIcon.click();
      await page.waitForTimeout(500);
      // Click on today's day number
      await page.getByRole("link", { name: String(today.getDate()), exact: true }).click();
      await page.waitForTimeout(300);
    }
  } catch {
    console.log("   ⚠️ Payment date calendar not found, skipping...");
  }

  return fechaPago;
}

async function confirmStep(page: Page): Promise<void> {
  const confirmBtn = page
    .locator('a:has-text("Confirmar"), input[value*="Confirmar"], button:has-text("Confirmar")')
    .first();
  await confirmBtn.click();
  await page.waitForLoadState("networkidle");
}
