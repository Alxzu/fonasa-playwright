import type { Locator, Page } from "playwright";
import type { Cascade } from "../selectors";
import { selectors } from "../selectors";

/** Every failure in this module is one of these, so callers can tell "BPS changed" from "BPS said no". */
export class SelectorError extends Error {
  constructor(
    message: string,
    readonly cascade: Cascade
  ) {
    super(message);
    this.name = "SelectorError";
  }
}

export class JsfValidationError extends Error {
  constructor(
    readonly step: string,
    readonly serverMessage: string
  ) {
    super(`BPS rejected ${step}: ${serverMessage}`);
    this.name = "JsfValidationError";
  }
}

export class VerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerificationError";
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Resolve an ordered cascade to a single locator.
 *
 * Iterates candidates ONE AT A TIME (plan A1): the first candidate that matches wins,
 * regardless of document order. Returns null if nothing matched.
 */
export async function tryResolve(page: Page, cascade: Cascade): Promise<Locator | null> {
  for (const candidate of cascade.candidates) {
    const locator = page.locator(candidate).first();
    if ((await locator.count()) > 0) return locator;
  }
  return null;
}

/** As `tryResolve`, but a miss is fatal and the diagnostic names every attempted selector. */
export async function resolve(page: Page, cascade: Cascade): Promise<Locator> {
  const locator = await tryResolve(page, cascade);
  if (locator) return locator;
  throw new SelectorError(
    `${cascade.label}: no selector matched. The page may have changed.\n` +
      `  Tried, in order:\n${cascade.candidates.map((c) => `    - ${c}`).join("\n")}\n` +
      `  Next step: re-run with HEADLESS=false, or inspect output/error_*.html and the trace.`,
    cascade
  );
}

/** Digits only — JSF converters reformat "150000" to "150.000" or "150.000,00". */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Fill a required field and PROVE the value stuck (plan F1).
 *
 * Two failures are caught here that the original code let through silently:
 *   1. no selector matched  → the form was submitted with an empty amount
 *   2. the value did not stick → a JSF client-side converter rejected or reformatted it
 * Both are fatal. For a bot whose entire job is putting the right number in a field,
 * an unfillable field must never be survivable.
 */
export async function fillRequired(page: Page, cascade: Cascade, value: string): Promise<void> {
  const locator = await resolve(page, cascade);
  await locator.fill(value);

  const applied = await locator.inputValue();
  if (digitsOnly(applied) !== digitsOnly(value)) {
    throw new VerificationError(
      `${cascade.label}: value did not stick — wanted "${value}", field contains "${applied}". ` +
        `A JSF converter may have rejected or reformatted it.`
    );
  }
}

/** Read an input's current value, or null when the field is absent. */
export async function readInputValue(page: Page, cascade: Cascade): Promise<string | null> {
  const locator = await tryResolve(page, cascade);
  if (!locator) return null;
  const tag = await locator.evaluate((el) => el.tagName.toLowerCase());
  if (tag === "input" || tag === "select" || tag === "textarea") {
    return (await locator.inputValue()).trim();
  }
  return ((await locator.textContent()) ?? "").trim();
}

/**
 * Gate every navigation (plan F6).
 *
 * A JSF postback that fails validation re-renders the SAME page with a message block, so
 * `waitForLoadState("networkidle")` resolves happily and step N+1 runs its selectors
 * against step N's DOM. That is the mechanism behind "cascade failure with a misleading
 * screenshot". Check for a populated message container before going on.
 */
export async function expectNoJsfErrors(page: Page, step: string): Promise<void> {
  const locator = await tryResolve(page, selectors.jsfErrors);
  if (!locator) return;
  const text = ((await locator.innerText()) ?? "").trim();
  if (text) throw new JsfValidationError(step, text);
}

/**
 * Assert we are where we think we are (plan F9).
 *
 * Replaces `waitForLoadState("networkidle")` + fixed `waitForTimeout`, which are timing
 * dependent and — on JSF, with keep-alive polling and partial postbacks — unreliable in
 * both directions. Waiting on something that only exists on the NEXT page is both the
 * correct wait and a free "am I on the right page?" assertion.
 */
export async function expectArrival(
  page: Page,
  cascade: Cascade,
  timeout = DEFAULT_TIMEOUT_MS
): Promise<void> {
  // Races every candidate's own `waitFor`, resolving as soon as ANY of them attaches.
  // Deliberately not a poll loop with `waitForTimeout` — there is no fixed sleep anywhere
  // in src/ (plan F9), and E2E-18 asserts that.
  const attempts = cascade.candidates.map((candidate) =>
    page.locator(candidate).first().waitFor({ state: "attached", timeout })
  );
  // Losers reject once their own timeout elapses; swallow those so they cannot surface as
  // unhandled rejections after we have already returned.
  for (const attempt of attempts) attempt.catch(() => {});

  try {
    await Promise.any(attempts);
  } catch {
    throw new SelectorError(
      `Did not arrive at ${cascade.label} within ${timeout}ms.\n` +
        `  Expected one of:\n${cascade.candidates.map((c) => `    - ${c}`).join("\n")}\n` +
        `  The previous step's postback may have been rejected, or BPS markup changed.`,
      cascade
    );
  }
}

/**
 * Click a navigation control, then assert both that BPS accepted the postback and that we
 * landed on the expected page. This pairing is what makes the wizard non-silent.
 */
export async function navigate(
  page: Page,
  control: Cascade,
  options: { from: string; arrival: Cascade }
): Promise<void> {
  const button = await resolve(page, control);
  await button.click();
  await page.waitForLoadState("domcontentloaded");
  await expectNoJsfErrors(page, options.from);
  await expectArrival(page, options.arrival);
}

/** Blank every input value in an HTML string (plan F13/H2 — PII must not reach debug artifacts). */
export async function scrubHtml(html: string): Promise<string> {
  return await new HTMLRewriter()
    .on("input", {
      element(element) {
        const type = (element.getAttribute("type") ?? "").toLowerCase();
        if (type === "checkbox" || type === "radio" || type === "submit" || type === "button") {
          return;
        }
        element.setAttribute("value", "");
      }
    })
    .on("textarea", {
      element(element) {
        element.setInnerContent("");
      }
    })
    .transform(new Response(html))
    .text();
}
