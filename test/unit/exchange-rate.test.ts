import { describe, expect, test } from "bun:test";
import type { RateDeps } from "../../src/utils/exchange-rate";
import { getExchangeRate, MAX_RETRIES, RATE_LEG } from "../../src/utils/exchange-rate";

const AUGUST_12_2026 = new Date(2026, 7, 12);
const API = "https://rates.example/api/v2/rates/usd-cash";

/** Records every URL requested, so the business-day walk-back is asserted, not assumed. */
function recorder(handler: (dateStr: string, call: number) => Response) {
  const dates: string[] = [];
  let call = 0;
  const fetchFn = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const dateStr = url.searchParams.get("date") ?? "";
    dates.push(dateStr);
    return handler(dateStr, call++);
  }) as unknown as typeof globalThis.fetch;
  return { dates, fetchFn };
}

const ok = (sell: number, buy = sell - 1) =>
  new Response(
    JSON.stringify({
      currency: { slug: "usd-cash", name: "USD" },
      date: "x",
      rates: { buy, sell },
      source: "BCU"
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );

const notFound = () =>
  new Response(JSON.stringify({ error: "No exchange rate available for this date" }), {
    status: 404,
    headers: { "content-type": "application/json" }
  });

function deps(fetchFn: typeof globalThis.fetch, today = AUGUST_12_2026): RateDeps {
  return { api: API, today, fetch: fetchFn, log: () => {} };
}

describe("getExchangeRate", () => {
  test("EX-01: returns the rate for the last business day of the previous month", async () => {
    const { dates, fetchFn } = recorder(() => ok(40.5));
    const result = await getExchangeRate(deps(fetchFn));

    // 2026-07-31 is a Friday, so no weekend walk-back is needed here.
    expect(dates).toEqual(["2026-07-31"]);
    expect(result).toEqual({ rate: 40.5, date: "2026-07-31", leg: "sell" });
  });

  test("EX-02: two 404s then success — asserts the exact dates walked", async () => {
    const { dates, fetchFn } = recorder((_date, call) => (call < 2 ? notFound() : ok(41)));
    const result = await getExchangeRate(deps(fetchFn));

    // Fri 31 Jul → Thu 30 Jul → Wed 29 Jul. The walk-back must never emit a weekend.
    expect(dates).toEqual(["2026-07-31", "2026-07-30", "2026-07-29"]);
    expect(result.date).toBe("2026-07-29");
    expect(result.rate).toBe(41);
  });

  test("EX-02: the walk-back skips the weekend", async () => {
    // From 2026-06-01, month-end is Sun 2026-05-31 → Fri 2026-05-29 → Thu 28 → Wed 27.
    const { dates, fetchFn } = recorder((_date, call) => (call < 2 ? notFound() : ok(39)));
    await getExchangeRate(deps(fetchFn, new Date(2026, 5, 1)));
    expect(dates).toEqual(["2026-05-29", "2026-05-28", "2026-05-27"]);
    for (const date of dates) {
      const day = new Date(`${date}T12:00:00`).getDay();
      expect([0, 6]).not.toContain(day);
    }
  });

  test("EX-03: a non-404 'No exchange rate available' body is treated as a retry", async () => {
    const { dates, fetchFn } = recorder((_date, call) =>
      call === 0
        ? new Response(JSON.stringify({ error: "No exchange rate available (holiday)" }), {
            status: 400
          })
        : ok(42)
    );
    const result = await getExchangeRate(deps(fetchFn));
    expect(dates).toHaveLength(2);
    expect(result.rate).toBe(42);
  });

  test("EX-04: a network error fails fast — no retry loop", async () => {
    const { dates, fetchFn } = recorder(() => {
      throw new TypeError("Unable to connect");
    });
    await expect(getExchangeRate(deps(fetchFn))).rejects.toThrow(/Unable to reach/);
    // The bug this guards: retrying a different DATE cannot fix a broken connection.
    expect(dates).toHaveLength(1);
  });

  test("EX-04: the error names the endpoint", async () => {
    const { fetchFn } = recorder(() => {
      throw new TypeError("ECONNREFUSED");
    });
    await expect(getExchangeRate(deps(fetchFn))).rejects.toThrow(API);
  });

  test("EX-05: HTTP 500 throws immediately with the status", async () => {
    const { dates, fetchFn } = recorder(() => new Response("boom", { status: 500 }));
    await expect(getExchangeRate(deps(fetchFn))).rejects.toThrow(/HTTP 500/);
    expect(dates).toHaveLength(1);
  });

  test("EX-06: exhausting the retries throws", async () => {
    const { dates, fetchFn } = recorder(() => notFound());
    await expect(getExchangeRate(deps(fetchFn))).rejects.toThrow(/after 10 attempts/);
    expect(dates).toHaveLength(MAX_RETRIES);
  });

  test("EX-07: the request carries an abort signal (timeout is armed)", async () => {
    let sawSignal = false;
    const fetchFn = (async (_input: unknown, init?: RequestInit) => {
      sawSignal = init?.signal instanceof AbortSignal;
      return ok(40);
    }) as unknown as typeof globalThis.fetch;
    await getExchangeRate(deps(fetchFn));
    expect(sawSignal).toBe(true);
  });

  test("EX-07: an aborted request is reported as unreachable, not retried", async () => {
    const { dates, fetchFn } = recorder(() => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    await expect(getExchangeRate(deps(fetchFn))).rejects.toThrow(/timed out/);
    expect(dates).toHaveLength(1);
  });

  test("EX-08: the rate leg is pinned, so changing it is a deliberate act", async () => {
    // Plan F5 / §8.1 is unresolved. This test exists so that switching to the interbank
    // leg cannot happen as a silent edit — it must be an explicit, reviewed change.
    expect(RATE_LEG).toBe("sell");

    const { fetchFn } = recorder(() => ok(45 /* sell */, 43 /* buy */));
    const result = await getExchangeRate(deps(fetchFn));
    expect(result.rate).toBe(45);
    expect(result.leg).toBe("sell");
  });

  test("EX-08: an unusable rate in an otherwise-OK response throws", async () => {
    const { fetchFn } = recorder(
      () =>
        new Response(JSON.stringify({ rates: { buy: 40, sell: null } }), {
          status: 200
        })
    );
    await expect(getExchangeRate(deps(fetchFn))).rejects.toThrow(/unusable/);
  });

  test("EX-08: a zero or negative rate is rejected", async () => {
    const { fetchFn } = recorder(() => ok(0));
    await expect(getExchangeRate(deps(fetchFn))).rejects.toThrow(/unusable/);
  });
});
