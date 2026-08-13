/**
 * Uruguayan cédula (CI) and RUT check digits (plan F19, spec CD-*).
 *
 * ⚠️  SHIPS AS A WARNING, NOT A HARD FAILURE (spec CD-04).
 *
 * These weight tables are written from published descriptions of the algorithms, and have
 * NOT been confirmed against real known-valid values (plan §8.4 is the open question).
 * A wrong check-digit implementation that blocks a valid monthly run is strictly worse
 * than no validation at all, so `validateConfig` only warns.
 *
 * To promote these to hard failures: confirm CD-01 and CD-03 against at least three real
 * known-valid documents, then flip `CHECK_DIGITS_CONFIRMED` and add the assertion.
 */
export const CHECK_DIGITS_CONFIRMED = false;

const CI_WEIGHTS = [2, 9, 8, 7, 6, 3, 4];
const RUT_WEIGHTS = [4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function digitsOf(value: string): number[] {
  return value.replace(/\D/g, "").split("").map(Number);
}

/** Compute the expected CI check digit for the 7 body digits. */
export function ciCheckDigit(body: number[]): number {
  const sum = body.reduce((acc, digit, i) => acc + digit * (CI_WEIGHTS[i] ?? 0), 0);
  return (10 - (sum % 10)) % 10;
}

/** Validate a cédula: 7 body digits + 1 check digit (shorter values are left-padded). */
export function isValidCedula(value: string): boolean {
  const digits = digitsOf(value);
  if (digits.length < 2 || digits.length > 8) return false;
  const padded = [...Array(8 - digits.length).fill(0), ...digits] as number[];
  const body = padded.slice(0, 7);
  const check = padded[7] as number;
  return ciCheckDigit(body) === check;
}

/** Compute the expected RUT check digit for the 11 body digits, or null if unrepresentable. */
export function rutCheckDigit(body: number[]): number | null {
  const sum = body.reduce((acc, digit, i) => acc + digit * (RUT_WEIGHTS[i] ?? 0), 0);
  const remainder = sum % 11;
  if (remainder === 0) return 0;
  const check = 11 - remainder;
  return check === 10 ? null : check;
}

/** Validate a RUT: 12 digits, the last being the check digit. */
export function isValidRut(value: string): boolean {
  const digits = digitsOf(value);
  if (digits.length !== 12) return false;
  const expected = rutCheckDigit(digits.slice(0, 11));
  return expected !== null && expected === digits[11];
}
