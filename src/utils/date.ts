/**
 * Date rules. Every function takes its clock as a parameter (plan §4.1) — the previous
 * signatures called `new Date()` internally, which made the month-end and weekend rules
 * untestable as a pair and impossible to test at all across year boundaries.
 */

/**
 * Format as YYYY-MM-DD from LOCAL parts (plan F11).
 *
 * `toISOString()` is UTC: from any UTC+ timezone a date built as local midnight
 * serialises to the previous calendar day, which silently changes which exchange rate
 * gets fetched. Accidentally safe from Montevideo (UTC-3) only.
 */
export function formatDateISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Format as DD/MM/YYYY (Spanish format). */
export function formatDateES(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * The calendar last day of the previous month. Pure, no weekend logic.
 * Split from the weekend walk-back (plan §4.1) so the two business rules are
 * independently testable.
 */
export function getLastDayOfPreviousMonth(today: Date = new Date()): Date {
  return new Date(today.getFullYear(), today.getMonth(), 0);
}

/** If the date falls on a weekend, walk back to the preceding Friday. Otherwise unchanged. */
export function toBusinessDay(date: Date): Date {
  const result = new Date(date);
  const dayOfWeek = result.getDay();
  if (dayOfWeek === 0) {
    result.setDate(result.getDate() - 2); // Sunday -> Friday
  } else if (dayOfWeek === 6) {
    result.setDate(result.getDate() - 1); // Saturday -> Friday
  }
  return result;
}

/** The last business day of the previous month — the date the BCU rate is quoted for. */
export function getLastBusinessDayOfPreviousMonth(today: Date = new Date()): Date {
  return toBusinessDay(getLastDayOfPreviousMonth(today));
}

/** Step back one day, then skip weekends. Pure — does not mutate its argument. */
export function getPreviousBusinessDay(date: Date): Date {
  const previous = new Date(date);
  previous.setDate(previous.getDate() - 1);
  return toBusinessDay(previous);
}

/**
 * The período this run should be invoicing: the month that just ended.
 * Returned as MM/YYYY, the form's display convention.
 *
 * This is the rule the step-2 assertion checks against (plan A3). It is stated here, in
 * one place, precisely so that "which month are we invoicing?" has a single answer the
 * code can assert rather than an assumption buried in a blind click.
 */
export function getExpectedPeriodo(today: Date = new Date()): string {
  const lastDay = getLastDayOfPreviousMonth(today);
  const month = String(lastDay.getMonth() + 1).padStart(2, "0");
  return `${month}/${lastDay.getFullYear()}`;
}

/**
 * Compare períodos by their digits, so "08/2026", "8/2026" and "08-2026" all agree.
 * Used by both the step-2 pre-check and the step-4 read-back, so the two cannot drift.
 */
export function normalizePeriodo(periodo: string): string {
  const match = /(\d{1,2})\D+(\d{4})/.exec(periodo);
  if (!match) return periodo.trim();
  return `${String(Number(match[1])).padStart(2, "0")}/${match[2]}`;
}

/** True if the two dates are the same calendar day in local time. */
export function isSameDay(a: Date, b: Date): boolean {
  return formatDateISO(a) === formatDateISO(b);
}
