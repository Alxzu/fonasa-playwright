import type { Page } from "playwright";
import { selectors } from "../selectors";
import { normalizePeriodo } from "../utils/date";
import { navigate, readInputValue, VerificationError } from "../utils/dom";

/**
 * Step 2: Tipo Factura.
 *
 * The original implementation was a blind click: it assumed "Anticipos mensuales" and the
 * período defaults were correct and never read back what BPS had actually selected.
 * The período decides WHICH MONTH is invoiced — an unnoticed change there produces a
 * perfectly valid invoice for the wrong period (plan A3).
 *
 * We now read the período back and assert it against the rule in `getExpectedPeriodo`.
 */
export async function fillStep2(page: Page, expectedPeriodo: string): Promise<string> {
  console.log("📄 Step 2: Verifying invoice type and período...");

  const periodo = await readInputValue(page, selectors.step2.periodo);

  if (periodo === null) {
    throw new VerificationError(
      `Could not read the período on step 2, so the month being invoiced cannot be ` +
        `verified. Refusing to continue — a wrong período produces a valid-looking ` +
        `invoice for the wrong month.\n` +
        `  Tried: ${selectors.step2.periodo.candidates.join(", ")}\n` +
        `  Fix: pin this selector from a captured page (docs/IMPROVEMENT_PLAN.md §7 item 9).`
    );
  }

  if (normalizePeriodo(periodo) !== normalizePeriodo(expectedPeriodo)) {
    throw new VerificationError(
      `Período mismatch: the form is set to "${periodo}" but this run expects ` +
        `"${expectedPeriodo}" (the month that just ended). Refusing to continue.`
    );
  }

  console.log(`   ✓ Período: ${periodo}`);

  await navigate(page, selectors.nav.siguiente, {
    from: "step 2 (Tipo Factura)",
    arrival: selectors.step3.arrival
  });

  console.log("✅ Step 2 completed\n");
  return periodo;
}
