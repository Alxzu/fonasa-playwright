import type { Page } from "playwright";
import { config } from "../config";

const BPS_FORM_URL =
  "https://app1.bps.gub.uy/SnisProfesionalesWeb/paginas/anticipos/snisAnticiposAInicio.jsf";

/**
 * Step 1: Datos del Titular
 * Navigate to form and fill holder data
 */
export async function fillStep1(page: Page): Promise<void> {
  console.log("📄 Step 1: Navigating to form and filling holder data...");

  await page.goto(BPS_FORM_URL);
  await page.waitForLoadState("networkidle");

  // Fill company data
  await page.getByRole("textbox", { name: "empresa" }).fill(config.empresa);
  await page.getByRole("textbox", { name: "rut" }).fill(config.rut);

  // Fill holder data
  await page.getByRole("textbox", { name: "Documento" }).fill(config.documento);

  // Fill date of birth
  await fillDateOfBirth(page, config.fechaNacimiento);

  // Click Next
  await page.getByRole("link", { name: "Siguiente >" }).click();
  await page.waitForLoadState("networkidle");

  console.log("✅ Step 1 completed\n");
}

/**
 * Fill date of birth using JavaScript evaluation
 * Finds the input by ID/name pattern and sets value directly
 */
async function fillDateOfBirth(page: Page, fecha: string): Promise<void> {
  await page.evaluate((fechaValue) => {
    const inputs = document.querySelectorAll("input");
    for (const input of inputs) {
      const id = input.id?.toLowerCase() || "";
      const name = input.name?.toLowerCase() || "";
      if (
        id.includes("fecha") ||
        name.includes("fecha") ||
        id.includes("nacimiento") ||
        name.includes("nacimiento") ||
        id.includes("fechnac") ||
        name.includes("fechnac")
      ) {
        (input as HTMLInputElement).value = fechaValue;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.dispatchEvent(new Event("blur", { bubbles: true }));
        return;
      }
    }
    // Fallback: try 4th input (usually fecha after empresa, rut, documento)
    if (inputs.length >= 4) {
      const input = inputs[3] as HTMLInputElement;
      input.value = fechaValue;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, fecha);

  await page.waitForTimeout(500);
}
