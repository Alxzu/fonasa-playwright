import type { Page } from "playwright";
import { selectors } from "../selectors";
import type { Config } from "../types";
import { formatDateES } from "../utils/date";
import {
  expectArrival,
  expectNoJsfErrors,
  fillRequired,
  readInputValue,
  resolve,
  tryResolve,
  VerificationError
} from "../utils/dom";

export interface Step3Result {
  /** Read off the form. Null when the field could not be set — never fabricated (plan F2). */
  fechaPago: string | null;
}

/**
 * Step 3: Datos Factura.
 * Fill the amounts and the payment date, then confirm.
 */
export async function fillStep3(
  page: Page,
  config: Config,
  montoUYU: number,
  baseCalculo: number,
  today: Date
): Promise<Step3Result> {
  console.log("📄 Step 3: Filling invoice data...");

  await fillTaxType(page, config);

  // Both of these throw if the field is missing or the value does not stick.
  // The original code did nothing on a miss and then clicked Confirmar anyway (plan F1).
  await fillRequired(page, selectors.step3.monto, String(montoUYU));
  await fillRequired(page, selectors.step3.baseCalculo, String(baseCalculo));

  const fechaPago = await fillPaymentDate(page, today);

  // Re-verify immediately before confirming.
  //
  // fillRequired's read-back runs right after fill(), which catches converters that fire
  // on `input`/`change`. JSF converters commonly fire on BLUR instead — so the monto can
  // still be mangled later, when the next field takes focus. Discovered by the
  // `amount-reformatted` mock scenario, which does exactly that.
  await assertStillSet(page, montoUYU, baseCalculo);

  await confirmStep(page);

  console.log("✅ Step 3 completed\n");
  return { fechaPago };
}

async function fillTaxType(page: Page, config: Config): Promise<void> {
  const select = await resolve(page, selectors.step3.impuesto);

  // Plan F21: try by value, then by label. Which one BPS uses is unconfirmed (§7 item 10),
  // and `selectOption("IRPF")` matches by VALUE only — a label-keyed select fails cryptically.
  try {
    await select.selectOption(config.impuesto);
  } catch {
    await select.selectOption({ label: config.impuesto });
  }

  const applied = await select.inputValue();
  console.log(`   ✓ Impuesto: ${config.impuesto} (option value "${applied}")`);
}

/**
 * Set the payment date and read it back.
 *
 * The original returned `formatDateES(today)` unconditionally, including from the catch
 * block — so the summary reported a payment date that may never have been entered
 * (plan F2). Here the return value comes from the FIELD, or is null.
 *
 * The calendar widget is deliberately not driven. RichFaces-style grids render adjacent
 * months' day cells, so clicking "the link named 1" can hit the wrong month (plan F3);
 * and which widget BPS uses is unconfirmed (§7 items 5-6). Setting the input directly and
 * verifying is both simpler and checkable. If the read-back fails we return null rather
 * than guessing — the caller decides whether that is fatal.
 */
async function fillPaymentDate(page: Page, today: Date): Promise<string | null> {
  const wanted = formatDateES(today);
  const input = await tryResolve(page, selectors.step3.fechaPago);

  if (!input) {
    console.log("   ⚠️ Payment date field not found — it will be reported as unset.");
    return null;
  }

  await input.evaluate((element, value) => {
    const field = element as HTMLInputElement;
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    field.dispatchEvent(new Event("blur", { bubbles: true }));
  }, wanted);

  const applied = await readInputValue(page, selectors.step3.fechaPago);
  if (!applied) {
    console.log("   ⚠️ Payment date did not stick — it will be reported as unset.");
    return null;
  }
  console.log(`   ✓ Fecha de pago: ${applied}`);
  return applied;
}

/** Final gate: the money fields must still hold what we put there (plan F1). */
async function assertStillSet(page: Page, montoUYU: number, baseCalculo: number): Promise<void> {
  for (const [cascade, expected] of [
    [selectors.step3.monto, montoUYU],
    [selectors.step3.baseCalculo, baseCalculo]
  ] as const) {
    const current = await readInputValue(page, cascade);
    if ((current ?? "").replace(/\D/g, "") !== String(expected)) {
      throw new VerificationError(
        `${cascade.label}: value did not stick — wanted "${expected}", field contains ` +
          `"${current ?? ""}" at confirmation time. A JSF converter may have rewritten it ` +
          `on blur. Refusing to confirm.`
      );
    }
  }
}

async function confirmStep(page: Page): Promise<void> {
  const button = await resolve(page, selectors.nav.confirmar);
  await button.click();
  await page.waitForLoadState("domcontentloaded");
  await expectNoJsfErrors(page, "step 3 (Datos Factura)");
  await expectArrival(page, selectors.step4.arrival);
}
