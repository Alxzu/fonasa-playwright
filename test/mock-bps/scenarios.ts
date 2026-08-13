/**
 * Named failure injections for the mock BPS (plan §3.4).
 *
 * The mock's job is NOT the happy path. It is to make each silent-failure finding
 * reproducible on demand, so every P0 in the plan has an executable regression test.
 * Each scenario names the finding it reproduces.
 */
export const SCENARIOS = {
  happy: "baseline — everything behaves",

  // ── step 3: the amount ──────────────────────────────────────────────────────────────
  "amount-field-renamed": "F1 — the monto input is gone; the run must throw, not confirm",
  "amount-reformatted": "F1 — a JSF converter rewrites the value after fill()",
  "amount-decoy-outer-row": "A1/A2 — a wrapper <tr> also contains 'Monto facturado'",
  "jsf-id-collision": "A2 — j_id460 exists alongside j_id46",

  // ── step 3: the payment date ────────────────────────────────────────────────────────
  "calendar-missing": "F2 — no fecha de pago field; must report null, never today's date",

  // ── step 1: the date-of-birth injection ─────────────────────────────────────────────
  "hidden-date-not-submitted": "F12 — the visible field does not sync to the hidden state field",

  // ── JSF postback semantics ──────────────────────────────────────────────────────────
  "validation-error-step1": "F6 — step 1 re-renders with a message block instead of advancing",
  "validation-error-step3": "F6 — step 3 re-renders with a message block instead of advancing",
  "slow-postback": "F9 — every render is delayed; anchored waits must still pass",

  // ── step 2: the período ─────────────────────────────────────────────────────────────
  "period-unexpected-default": "A3 — BPS pre-selects a different período",

  // ── step 4: the results ─────────────────────────────────────────────────────────────
  "confirm-amount-mismatch": "A4 — the results page shows a different monto",
  "link-no-ref": "F4 — the payment link carries no ref= parameter",
  "duplicate-pagar-link": "F8 — 'Pagar Factura' appears twice",
  "pdf-zero-bytes": "F14 — the download is empty",
  "pdf-is-html-error": "F14 — the download is an HTML error page"
} as const;

export type Scenario = keyof typeof SCENARIOS;

export const ALL_SCENARIOS = Object.keys(SCENARIOS) as Scenario[];

export function isScenario(value: string): value is Scenario {
  return value in SCENARIOS;
}
