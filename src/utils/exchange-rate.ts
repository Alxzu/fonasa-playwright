import type { ExchangeRate, ExchangeRateError, ExchangeRateResponse } from "../types";
import { formatDateISO, getLastBusinessDayOfPreviousMonth, getPreviousBusinessDay } from "./date";

/** Max days to walk back, for runs of consecutive holidays. */
export const MAX_RETRIES = 10;

/** Request timeout — a sleeping self-hosted proxy must not block the run forever (plan F10). */
export const FETCH_TIMEOUT_MS = 10_000;

/**
 * Which leg of the quote to use.
 *
 * OPEN QUESTION (plan F5, §8.1): this is currently `sell` against the `usd-cash`
 * (billete) endpoint — the highest of the four legs. The conventional rate for converting
 * foreign-currency income is typically interbank. Direction of harm is over-declaring, so
 * this is a money cost rather than a compliance exposure, but it is unresolved.
 * It is a named constant, and EX-08 asserts it, so changing it is a deliberate,
 * test-visible act rather than a silent edit.
 */
export const RATE_LEG: "buy" | "sell" = "sell";

export interface RateDeps {
  api: string;
  today: Date;
  fetch: typeof globalThis.fetch;
  log: (message: string) => void;
}

/**
 * Fetch the USD rate for the last business day of the previous month, walking back a day
 * at a time when the API reports no rate for that date (holidays).
 *
 * Dependencies are injected (plan §4.2) — the previous version read module-scoped config
 * and global fetch, which made every one of the EX specs untestable.
 */
export async function getExchangeRate(deps: RateDeps): Promise<ExchangeRate> {
  const { api, today, fetch: fetchFn, log } = deps;
  let currentDate = getLastBusinessDayOfPreviousMonth(today);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const dateStr = formatDateISO(currentDate);
    const url = `${api}?date=${dateStr}`;

    log(`📊 Fetching exchange rate for ${dateStr}...`);

    let response: Response;
    try {
      response = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (networkError) {
      // Network error, DNS failure, or timeout. Fail fast: retrying a different DATE
      // cannot fix a broken connection, and silently looping ten times hides the cause.
      const detail = networkError instanceof Error ? networkError.message : String(networkError);
      throw new Error(
        `Unable to reach the exchange rate API at ${api} (${detail}). Check network/server.`
      );
    }

    if (response.ok) {
      const data = (await response.json()) as ExchangeRateResponse;
      const rate = data.rates?.[RATE_LEG];
      if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
        throw new Error(
          `Exchange rate API returned an unusable "${RATE_LEG}" rate for ${dateStr}: ${JSON.stringify(data.rates)}`
        );
      }
      log(`   ✅ Rate: ${rate} UYU/USD (${RATE_LEG})\n`);
      return { rate, date: dateStr, leg: RATE_LEG };
    }

    let errorData: ExchangeRateError | null = null;
    try {
      errorData = (await response.json()) as ExchangeRateError;
    } catch {
      // Body was not JSON; fall through with what we have.
    }

    const isMissingRate =
      response.status === 404 || Boolean(errorData?.error?.includes("No exchange rate available"));

    if (isMissingRate) {
      log(`   ⚠️  No rate for ${dateStr} (holiday/weekend), trying previous day...`);
      if (errorData?.suggestion) log(`      💡 ${errorData.suggestion}`);
      currentDate = getPreviousBusinessDay(currentDate);
      continue;
    }

    throw new Error(
      `Failed to fetch exchange rate: ${errorData?.error ?? `HTTP ${response.status}`} for date ${dateStr}`
    );
  }

  throw new Error(`Could not find an exchange rate after ${MAX_RETRIES} attempts`);
}
