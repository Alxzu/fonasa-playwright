import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "playwright";
import { allCascades, selectors } from "../../src/selectors";
import { resolve, tryResolve } from "../../src/utils/dom";
import { type RenderState, renderStep1, renderStep3, renderStep4 } from "../mock-bps/render";

/**
 * Selector cascades against the Tier A hazard fixtures (plan SL-*).
 * No server, no BPS — `page.setContent()` only.
 */

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});

afterAll(async () => {
  await browser.close();
});

const state = (overrides: Partial<RenderState> = {}): RenderState => ({
  scenario: "happy",
  periodo: "07/2026",
  monto: "150000",
  base: "105000",
  referencia: "900001",
  messages: [],
  ...overrides
});

describe("SL-01: every cascade resolves to exactly one element", () => {
  test("step 1 fields", async () => {
    await page.setContent(renderStep1(state()));
    for (const cascade of [
      selectors.step1.empresa,
      selectors.step1.rut,
      selectors.step1.documento,
      selectors.step1.fechaNacimiento
    ]) {
      const locator = await resolve(page, cascade);
      expect(await locator.count()).toBe(1);
    }
  });

  test("step 3 fields", async () => {
    await page.setContent(renderStep3(state()));
    for (const cascade of [
      selectors.step3.impuesto,
      selectors.step3.monto,
      selectors.step3.baseCalculo,
      selectors.step3.fechaPago
    ]) {
      const locator = await resolve(page, cascade);
      expect(await locator.count()).toBe(1);
    }
  });

  test("step 4 fields", async () => {
    await page.setContent(renderStep4(state()));
    for (const cascade of [
      selectors.step4.paymentLink,
      selectors.step4.downloadLink,
      selectors.step4.montoConfirmado,
      selectors.step4.periodo
    ]) {
      const locator = await resolve(page, cascade);
      expect(await locator.count()).toBe(1);
    }
  });
});

describe("SL-02: the amount cascade never resolves to an identity field", () => {
  test("a wrapper row containing 'Monto facturado' does not divert the amount", async () => {
    // This is the A2 regression, proved in plan §10: the OLD fallback
    // `tr:has-text("Monto") input` matched the outer wrapper row and `.first()` resolved to
    // the empresa field, so the invoice amount was typed into an identity field.
    await page.setContent(renderStep3(state({ scenario: "amount-decoy-outer-row" })));

    const locator = await resolve(page, selectors.step3.monto);
    const id = await locator.getAttribute("id");
    expect(id).toBe("formulario:montoFacturado");
    expect(id).not.toContain("decoy");

    // And prove the old approach really would have gone wrong on this same fixture.
    const oldStyle = page.locator('tr:has-text("Monto facturado") input').first();
    expect(await oldStyle.getAttribute("id")).not.toBe("formulario:montoFacturado");
  });
});

describe("SL-03: cascade order is honoured, regardless of document order", () => {
  test("an earlier candidate wins even when a later one appears first in the DOM", async () => {
    // The core A1 regression. `locator('a, b').first()` picks by DOCUMENT order, so the
    // apparent priority in a comma-joined selector does not exist.
    await page.setContent(
      `<input id="decoy_monto" value="DECOY"><input id="formulario:montoFacturado" value="REAL">`
    );
    const locator = await resolve(page, selectors.step3.monto);
    expect(await locator.inputValue()).toBe("REAL");

    const union = page.locator(selectors.step3.monto.candidates.join(", ")).first();
    expect(await union.inputValue()).toBe("DECOY");
  });

  test("a j_id460 decoy does not capture the j_id46 cascade entry", async () => {
    await page.setContent(renderStep3(state({ scenario: "jsf-id-collision" })));
    const locator = await resolve(page, selectors.step3.monto);
    expect(await locator.getAttribute("name")).toBe("formulario:j_id46");
  });
});

describe("SL-04: the DOB cascade selects the visible input, not the hidden state field", () => {
  test("a hidden companion that precedes the visible input is skipped", async () => {
    await page.setContent(renderStep1(state()));

    const locator = await resolve(page, selectors.step1.fechaNacimiento);
    expect(await locator.getAttribute("type")).toBe("text");
    expect(await locator.getAttribute("id")).toBe("formulario:fechaNacimientoInputDate");

    // The hazard is real: the hidden field comes first and its id ends in "fechaNacimiento".
    const naive = page.locator('input[name*="fecha"]').first();
    expect(await naive.getAttribute("type")).toBe("hidden");
  });
});

describe("SL-05: the payment-link cascade disambiguates", () => {
  test("returns one href when 'Pagar Factura' appears twice", async () => {
    await page.setContent(renderStep4(state({ scenario: "duplicate-pagar-link" })));

    const locator = await resolve(page, selectors.step4.paymentLink);
    expect(await locator.count()).toBe(1);
    expect(await locator.getAttribute("href")).toContain("ref=900001");

    // Strict mode would have thrown on the un-.first()'d original (plan F8).
    expect(await page.locator('a:has-text("Pagar Factura")').count()).toBe(2);
  });

  test("does not resolve to the PDF download link", async () => {
    await page.setContent(renderStep4(state()));
    const locator = await resolve(page, selectors.step4.paymentLink);
    expect(await locator.getAttribute("id")).toBe("pagar");
  });
});

describe("SL-06: a miss is loud", () => {
  test("names the label and every attempted selector", async () => {
    await page.setContent("<html><body>nothing here</body></html>");

    expect(await tryResolve(page, selectors.step3.monto)).toBeNull();
    await expect(resolve(page, selectors.step3.monto)).rejects.toThrow(/monto facturado/);
    await expect(resolve(page, selectors.step3.monto)).rejects.toThrow(
      /input\[id\$="montoFacturado"\]/
    );
    await expect(resolve(page, selectors.step3.monto)).rejects.toThrow(/HEADLESS=false/);
  });
});

describe("cascade hygiene", () => {
  test("no cascade is empty and every one has a label", () => {
    for (const cascade of allCascades()) {
      expect(cascade.candidates.length).toBeGreaterThan(0);
      expect(cascade.label.length).toBeGreaterThan(0);
    }
  });

  test("reports how many cascades are still unverified against real BPS markup", () => {
    // Not a failure — a standing reminder that Tier A proves "not naive", not "correct".
    // The live-capture session (plan §7) is what retires these.
    const all = allCascades();
    const unverified = all.filter((c) => !c.verified);
    console.log(
      `   ℹ️  ${unverified.length}/${all.length} selector cascades are @bps-unverified ` +
        `(retired by the live-capture session, plan §7)`
    );
    expect(all.length).toBeGreaterThan(0);
  });
});
