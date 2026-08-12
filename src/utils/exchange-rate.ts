import { config } from "../config";
import type { ExchangeRate, ExchangeRateError, ExchangeRateResponse } from "../types";
import { formatDateISO, getLastDayOfPreviousMonth, getPreviousBusinessDay } from "./date";

const MAX_RETRIES = 10; // Max days to go back (in case of consecutive holidays)

/**
 * Fetch USD exchange rate from BCU API
 * Retries with previous business days if the date is a holiday (404)
 * Also handles network errors and JSON error responses
 */
export async function getExchangeRate(): Promise<ExchangeRate> {
  let currentDate = getLastDayOfPreviousMonth();

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const dateStr = formatDateISO(currentDate);
    const url = `${config.exchangeRateAPI}?date=${dateStr}`;

    console.log(`📊 Fetching exchange rate for ${dateStr}...`);

    let response: Response;
    try {
      response = await fetch(url);
    } catch (networkError) {
      // Network error (connection refused, DNS failure, etc.)
      console.error(
        `   ❌ Network error: ${networkError instanceof Error ? networkError.message : networkError}`,
      );
      throw new Error(
        `Unable to connect to exchange rate API at ${config.exchangeRateAPI}. Check network/server.`,
      );
    }

    if (response.ok) {
      const data = (await response.json()) as ExchangeRateResponse;
      console.log(`   ✅ Rate: ${data.rates.sell} UYU/USD\n`);

      return {
        rate: data.rates.sell,
        date: dateStr,
      };
    }

    // Handle error responses (404, etc.)
    let errorData: ExchangeRateError | null = null;
    try {
      errorData = (await response.json()) as ExchangeRateError;
    } catch {
      // Response body is not JSON, ignore
    }

    if (response.status === 404 || errorData?.error?.includes("No exchange rate available")) {
      console.log(
        `   ⚠️  No rate available for ${dateStr} (holiday/weekend), trying previous day...`,
      );
      if (errorData?.suggestion) {
        console.log(`      💡 ${errorData.suggestion}`);
      }
      currentDate = getPreviousBusinessDay(currentDate);
      continue;
    }

    // Other errors should throw with details
    const errorMessage = errorData?.error || `HTTP ${response.status}`;
    throw new Error(`Failed to fetch exchange rate: ${errorMessage} for date ${dateStr}`);
  }

  throw new Error(`Could not find exchange rate after ${MAX_RETRIES} attempts`);
}
