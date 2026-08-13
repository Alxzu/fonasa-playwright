import { describe, expect, test } from "bun:test";
import {
  formatDateES,
  formatDateISO,
  getExpectedPeriodo,
  getLastBusinessDayOfPreviousMonth,
  getLastDayOfPreviousMonth,
  getPreviousBusinessDay,
  toBusinessDay
} from "../../src/utils/date";

/** Local-midnight constructor, to keep the timezone question explicit in every test. */
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

describe("formatDateISO", () => {
  test("DT-01: formats from local parts, not UTC", () => {
    // The bug this guards: `toISOString()` on a local-midnight date in any UTC+ timezone
    // serialises to the PREVIOUS calendar day, silently changing which rate is fetched.
    expect(formatDateISO(d(2026, 7, 31))).toBe("2026-07-31");
    expect(formatDateISO(d(2026, 1, 1))).toBe("2026-01-01");
    expect(formatDateISO(d(2026, 12, 31))).toBe("2026-12-31");
  });

  test("DT-01: agrees with the date's own local getters for every month", () => {
    for (let month = 1; month <= 12; month++) {
      const date = d(2026, month, 1);
      const [year, mm, dd] = formatDateISO(date).split("-").map(Number);
      expect([year, mm, dd]).toEqual([date.getFullYear(), date.getMonth() + 1, date.getDate()]);
    }
  });

  test("DT-01: pads single-digit months and days", () => {
    expect(formatDateISO(d(2026, 3, 5))).toBe("2026-03-05");
  });
});

describe("formatDateES", () => {
  test("DT-02: DD/MM/YYYY, zero padded", () => {
    expect(formatDateES(d(2026, 3, 5))).toBe("05/03/2026");
    expect(formatDateES(d(1990, 12, 17))).toBe("17/12/1990");
  });
});

describe("getLastDayOfPreviousMonth", () => {
  test("DT-03: 31-, 30- and 28-day months", () => {
    expect(formatDateISO(getLastDayOfPreviousMonth(d(2026, 9, 15)))).toBe("2026-08-31");
    expect(formatDateISO(getLastDayOfPreviousMonth(d(2026, 5, 15)))).toBe("2026-04-30");
    expect(formatDateISO(getLastDayOfPreviousMonth(d(2026, 3, 15)))).toBe("2026-02-28");
  });

  test("DT-04: leap February", () => {
    expect(formatDateISO(getLastDayOfPreviousMonth(d(2028, 3, 10)))).toBe("2028-02-29");
  });

  test("DT-05: January rolls back to 31 December of the previous year", () => {
    expect(formatDateISO(getLastDayOfPreviousMonth(d(2026, 1, 10)))).toBe("2025-12-31");
  });

  test("DT-03: independent of the day-of-month it is asked on", () => {
    for (const day of [1, 14, 28, 31]) {
      expect(formatDateISO(getLastDayOfPreviousMonth(d(2026, 8, day)))).toBe("2026-07-31");
    }
  });
});

describe("toBusinessDay / getLastBusinessDayOfPreviousMonth", () => {
  test("DT-06: Saturday walks back to Friday", () => {
    expect(d(2026, 8, 1).getDay()).toBe(6);
    expect(formatDateISO(toBusinessDay(d(2026, 8, 1)))).toBe("2026-07-31");
  });

  test("DT-06: Sunday walks back to Friday", () => {
    expect(d(2026, 8, 2).getDay()).toBe(0);
    expect(formatDateISO(toBusinessDay(d(2026, 8, 2)))).toBe("2026-07-31");
  });

  test("DT-06: a weekday is unchanged", () => {
    expect(formatDateISO(toBusinessDay(d(2026, 7, 31)))).toBe("2026-07-31");
  });

  test("DT-06: a month ending on Sunday resolves to the preceding Friday", () => {
    // 2026-11-30 is a Monday; 2026-05-31 is a Sunday.
    expect(d(2026, 5, 31).getDay()).toBe(0);
    expect(formatDateISO(getLastBusinessDayOfPreviousMonth(d(2026, 6, 5)))).toBe("2026-05-29");
  });

  test("DT-06: a month ending on Saturday resolves to the preceding Friday", () => {
    expect(d(2026, 10, 31).getDay()).toBe(6);
    expect(formatDateISO(getLastBusinessDayOfPreviousMonth(d(2026, 11, 3)))).toBe("2026-10-30");
  });

  test("DT-08: does not mutate its argument", () => {
    const input = d(2026, 8, 2);
    const before = input.getTime();
    toBusinessDay(input);
    expect(input.getTime()).toBe(before);
  });
});

describe("getPreviousBusinessDay", () => {
  test("DT-07: Monday → Friday", () => {
    expect(d(2026, 8, 10).getDay()).toBe(1);
    expect(formatDateISO(getPreviousBusinessDay(d(2026, 8, 10)))).toBe("2026-08-07");
  });

  test("DT-07: Sunday → Friday", () => {
    expect(formatDateISO(getPreviousBusinessDay(d(2026, 8, 9)))).toBe("2026-08-07");
  });

  test("DT-07: Saturday → Friday", () => {
    expect(formatDateISO(getPreviousBusinessDay(d(2026, 8, 8)))).toBe("2026-08-07");
  });

  test("DT-07: Tuesday → Monday", () => {
    expect(formatDateISO(getPreviousBusinessDay(d(2026, 8, 11)))).toBe("2026-08-10");
  });

  test("DT-07: crosses a month boundary", () => {
    expect(formatDateISO(getPreviousBusinessDay(d(2026, 9, 1)))).toBe("2026-08-31");
  });

  test("DT-08: does not mutate its argument", () => {
    const input = d(2026, 8, 10);
    const before = input.getTime();
    getPreviousBusinessDay(input);
    expect(input.getTime()).toBe(before);
  });

  test("DT-07: repeated application never lands on a weekend", () => {
    let date = d(2026, 8, 31);
    for (let i = 0; i < 30; i++) {
      date = getPreviousBusinessDay(date);
      expect([0, 6]).not.toContain(date.getDay());
    }
  });
});

describe("getExpectedPeriodo", () => {
  test("A3: the período is the month that just ended", () => {
    expect(getExpectedPeriodo(d(2026, 8, 12))).toBe("07/2026");
    expect(getExpectedPeriodo(d(2026, 8, 1))).toBe("07/2026");
    expect(getExpectedPeriodo(d(2026, 1, 3))).toBe("12/2025");
  });
});
