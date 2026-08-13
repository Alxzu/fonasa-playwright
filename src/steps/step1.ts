import type { Page } from "playwright";
import { selectors } from "../selectors";
import type { Config } from "../types";
import { expectArrival, fillRequired, navigate, resolve, VerificationError } from "../utils/dom";

/**
 * Step 1: Datos del Titular.
 * Navigate to the form and fill holder data.
 */
export async function fillStep1(page: Page, config: Config): Promise<void> {
  console.log("📄 Step 1: Navigating to form and filling holder data...");

  await page.goto(config.formUrl, { waitUntil: "domcontentloaded" });
  await expectArrival(page, selectors.step1.arrival);

  await fillRequired(page, selectors.step1.empresa, config.empresa);
  await fillRequired(page, selectors.step1.rut, config.rut);
  await fillRequired(page, selectors.step1.documento, config.documento);
  await fillDateOfBirth(page, config.fechaNacimiento);

  await navigate(page, selectors.nav.siguiente, {
    from: "step 1 (Datos del Titular)",
    arrival: selectors.step2.arrival
  });

  console.log("✅ Step 1 completed\n");
}

/**
 * Fill the date of birth.
 *
 * JSF date widgets commonly reject synthetic typing, so the value is set directly and the
 * events the widget listens for are dispatched. Two changes from the original (plan F12):
 *
 *   1. The target is resolved through the selector cascade, which excludes `type=hidden`.
 *      The old code walked `querySelectorAll("input")` and returned on the first id/name
 *      containing "fecha" — if JSF's hidden companion state field came first in the DOM it
 *      filled the HIDDEN field and left the visible one empty.
 *   2. The value is READ BACK. Setting `.value` and hoping is exactly the silent path this
 *      project keeps getting bitten by.
 *
 * The positional `inputs[3]` fallback is gone: guessing at an index on a page whose shape
 * we could not confirm is how you fill a stranger's field with your birth date.
 */
async function fillDateOfBirth(page: Page, fecha: string): Promise<void> {
  const input = await resolve(page, selectors.step1.fechaNacimiento);

  await input.evaluate((element, value) => {
    const field = element as HTMLInputElement;
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    field.dispatchEvent(new Event("blur", { bubbles: true }));
  }, fecha);

  const applied = (await input.inputValue()).trim();
  if (applied !== fecha) {
    throw new VerificationError(
      `fecha de nacimiento: value did not stick — wanted "${fecha}", field contains "${applied}".`
    );
  }
}
