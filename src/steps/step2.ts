import type { Page } from "playwright";

/**
 * Step 2: Tipo Factura
 * Select invoice type (defaults are pre-selected)
 */
export async function fillStep2(page: Page): Promise<void> {
  console.log("📄 Step 2: Selecting invoice type...");

  // Default "Anticipos mensuales" is already selected
  // Period defaults are also pre-filled

  await page.getByRole("link", { name: "Siguiente >" }).click();
  await page.waitForLoadState("networkidle");

  console.log("✅ Step 2 completed\n");
}
