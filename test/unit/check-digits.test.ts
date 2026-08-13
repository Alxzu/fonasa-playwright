import { describe, expect, test } from "bun:test";
import {
  CHECK_DIGITS_CONFIRMED,
  ciCheckDigit,
  isValidCedula,
  isValidRut,
  rutCheckDigit
} from "../../src/utils/check-digits";

/**
 * These specs deliberately do NOT hardcode real cédulas or RUTs.
 *
 * Two reasons. Real identity documents do not belong in a repo. And more importantly,
 * asserting against values taken from the same source as the algorithm would prove only
 * that the implementation agrees with itself.
 *
 * So we test the properties that must hold for ANY correct check-digit scheme:
 * round-tripping, and sensitivity to single-digit and transposition errors. Confirming
 * the weight tables against real documents is plan §8.4 and stays an open question — see
 * CD-04 for why this ships as a warning.
 */

const body = (digits: string) => digits.split("").map(Number);

describe("cédula check digit", () => {
  test("CD-01: a computed check digit round-trips", () => {
    for (const seven of ["1234567", "0000001", "9876543", "4815162"]) {
      const check = ciCheckDigit(body(seven));
      expect(isValidCedula(`${seven}${check}`)).toBe(true);
    }
  });

  test("CD-02: changing any single body digit breaks it", () => {
    const seven = "1234567";
    const valid = `${seven}${ciCheckDigit(body(seven))}`;
    for (let i = 0; i < 7; i++) {
      const mutated = valid.split("");
      mutated[i] = String((Number(mutated[i]) + 1) % 10);
      expect(isValidCedula(mutated.join(""))).toBe(false);
    }
  });

  test("CD-02: a wrong check digit fails", () => {
    const seven = "1234567";
    const check = ciCheckDigit(body(seven));
    expect(isValidCedula(`${seven}${(check + 1) % 10}`)).toBe(false);
  });

  test("CD-02: detects an adjacent transposition", () => {
    // Weighted-sum schemes catch transpositions only when the two weights differ.
    const seven = "1234567";
    const valid = `${seven}${ciCheckDigit(body(seven))}`;
    const swapped = valid.split("");
    [swapped[2], swapped[3]] = [swapped[3] as string, swapped[2] as string];
    expect(isValidCedula(swapped.join(""))).toBe(false);
  });

  test("CD-01: tolerates dots and dashes", () => {
    const seven = "1234567";
    const check = ciCheckDigit(body(seven));
    expect(isValidCedula(`1.234.567-${check}`)).toBe(true);
  });

  test("rejects implausible lengths outright", () => {
    expect(isValidCedula("")).toBe(false);
    expect(isValidCedula("1")).toBe(false);
    expect(isValidCedula("123456789012")).toBe(false);
  });
});

describe("RUT check digit", () => {
  test("CD-03: a computed check digit round-trips", () => {
    let checked = 0;
    for (const eleven of ["21234567001", "12345678901", "98765432109", "10000000000"]) {
      const check = rutCheckDigit(body(eleven));
      if (check === null) continue; // remainder 1 has no representable digit
      expect(isValidRut(`${eleven}${check}`)).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  test("CD-03: changing any single body digit breaks it", () => {
    const eleven = "21234567001";
    const check = rutCheckDigit(body(eleven));
    expect(check).not.toBeNull();
    const valid = `${eleven}${check}`;
    for (let i = 0; i < 11; i++) {
      const mutated = valid.split("");
      mutated[i] = String((Number(mutated[i]) + 1) % 10);
      // A mutation can push the remainder to the unrepresentable case, which also fails.
      expect(isValidRut(mutated.join(""))).toBe(false);
    }
  });

  test("CD-03: wrong length is rejected", () => {
    expect(isValidRut("1234567890")).toBe(false);
    expect(isValidRut("1234567890123")).toBe(false);
  });
});

describe("promotion gate", () => {
  test("CD-04: still a warning — flip only after confirming against real values", () => {
    // If this fails, someone confirmed the tables (plan §8.4). Add the hard assertion in
    // validateConfig at the same time, and update this test to match.
    expect(CHECK_DIGITS_CONFIRMED).toBe(false);
  });
});
