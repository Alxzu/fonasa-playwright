import { describe, expect, test } from "bun:test";
import { parseCliArgs } from "../../src/cli";
import { DEFAULT_FORM_URL, loadConfig, validateConfig } from "../../src/config";
import { IMPUESTOS } from "../../src/types";

const VALID_ENV = {
  BPS_EMPRESA: "1234567",
  BPS_RUT: "123456789012",
  BPS_DOCUMENTO: "12345678",
  BPS_FECHA_NAC: "17/07/1990",
  BPS_MONTO_USD: "1000"
};

const configFrom = (env: Record<string, string | undefined>) => loadConfig(env, {});

describe("loadConfig", () => {
  test("CF-06: headless defaults to true and only 'false' disables it", () => {
    expect(configFrom(VALID_ENV).headless).toBe(true);
    expect(configFrom({ ...VALID_ENV, HEADLESS: "false" }).headless).toBe(false);
    expect(configFrom({ ...VALID_ENV, HEADLESS: "0" }).headless).toBe(true);
    expect(configFrom({ ...VALID_ENV, HEADLESS: "no" }).headless).toBe(true);
  });

  test("§4.4: the form URL is configurable and defaults to the real BPS host", () => {
    expect(configFrom(VALID_ENV).formUrl).toBe(DEFAULT_FORM_URL);
    expect(configFrom({ ...VALID_ENV, BPS_FORM_URL: "http://localhost:3999/" }).formUrl).toBe(
      "http://localhost:3999/"
    );
  });

  test("F18: --usd overrides the environment", () => {
    expect(loadConfig(VALID_ENV, { usd: 1500 }).montoUSD).toBe(1500);
    expect(loadConfig(VALID_ENV, {}).montoUSD).toBe(1000);
  });
});

describe("validateConfig", () => {
  test("CF-01: names every missing variable", () => {
    const config = configFrom({ BPS_MONTO_USD: "1000" });
    expect(() => validateConfig(config)).toThrow(/empresa/);
    expect(() => validateConfig(config)).toThrow(/rut/);
    expect(() => validateConfig(config)).toThrow(/documento/);
    expect(() => validateConfig(config)).toThrow(/fechaNacimiento/);
  });

  test("CF-02: accepts a valid DD/MM/YYYY date", () => {
    expect(() => validateConfig(configFrom(VALID_ENV))).not.toThrow();
  });

  test("CF-02: rejects malformed dates", () => {
    for (const bad of ["1990-07-17", "17/7/1990", "17-07-1990", "not a date", "170719900"]) {
      expect(() => validateConfig(configFrom({ ...VALID_ENV, BPS_FECHA_NAC: bad }))).toThrow(
        /Invalid date/
      );
    }
  });

  test("CF-03: rejects a structurally valid but impossible date", () => {
    // The old regex-only check accepted these; a JSF validation error 30 seconds into a
    // browser run is a much worse way to learn about a typo.
    for (const impossible of ["31/02/1990", "30/02/2000", "32/01/1990", "01/13/1990"]) {
      expect(() => validateConfig(configFrom({ ...VALID_ENV, BPS_FECHA_NAC: impossible }))).toThrow(
        /Invalid date/
      );
    }
  });

  test("CF-03: accepts a real leap day and rejects a fake one", () => {
    expect(() =>
      validateConfig(configFrom({ ...VALID_ENV, BPS_FECHA_NAC: "29/02/2000" }))
    ).not.toThrow();
    expect(() => validateConfig(configFrom({ ...VALID_ENV, BPS_FECHA_NAC: "29/02/1900" }))).toThrow(
      /Invalid date/
    );
  });

  test("CF-04: rejects non-positive, NaN and non-numeric amounts", () => {
    for (const bad of ["0", "-5", "abc", ""]) {
      expect(() => validateConfig(configFrom({ ...VALID_ENV, BPS_MONTO_USD: bad }))).toThrow(
        /Invalid amount/
      );
    }
    expect(() => validateConfig(configFrom({ ...VALID_ENV, BPS_MONTO_USD: undefined }))).toThrow(
      /Invalid amount/
    );
  });

  test("CF-05: rejects an impuesto outside the three legal values", () => {
    expect(() => validateConfig(configFrom({ ...VALID_ENV, BPS_IMPUESTO: "IVA" }))).toThrow(
      /Invalid BPS_IMPUESTO/
    );
    // The failure mode this prevents: selectOption() failing cryptically at step 3.
    for (const impuesto of IMPUESTOS) {
      expect(() =>
        validateConfig(configFrom({ ...VALID_ENV, BPS_IMPUESTO: impuesto }))
      ).not.toThrow();
    }
  });

  test("CF-05: defaults to IRPF", () => {
    expect(configFrom(VALID_ENV).impuesto).toBe("IRPF");
  });

  test("rejects a non-http form URL", () => {
    expect(() =>
      validateConfig(configFrom({ ...VALID_ENV, BPS_FORM_URL: "file:///etc/passwd" }))
    ).toThrow(/Invalid BPS_FORM_URL/);
  });

  test("CD-04: a failing check digit warns but never throws", () => {
    // Plan §8.4: the check-digit tables are unconfirmed against real values. A wrong
    // implementation that blocks a valid monthly run is worse than no validation.
    // NB: "11111111" is NOT a good example — it genuinely satisfies the CI check digit
    // (weights sum to 39, so the expected digit is 1). "12345678" expects 2 and so fails.
    const bad = { ...VALID_ENV, BPS_DOCUMENTO: "12345678" };
    const warnings = validateConfig(configFrom(bad));
    expect(warnings.some((w) => w.includes("cédula"))).toBe(true);
    expect(() => validateConfig(configFrom(bad))).not.toThrow();
  });

  test("CD-04: a valid check digit produces no warning", () => {
    expect(validateConfig(configFrom({ ...VALID_ENV, BPS_DOCUMENTO: "11111111" }))).not.toContain(
      expect.stringContaining("cédula")
    );
  });
});

describe("parseCliArgs", () => {
  test("F18: parses the flags", () => {
    const options = parseCliArgs(["--usd", "1500", "--force", "--json"]);
    expect(options.usd).toBe(1500);
    expect(options.force).toBe(true);
    expect(options.json).toBe(true);
    expect(options.dryRun).toBe(false);
  });

  test("F18: defaults are all off", () => {
    const options = parseCliArgs([]);
    expect(options.usd).toBeUndefined();
    expect(options.force).toBe(false);
    expect(options.dryRun).toBe(false);
  });

  test("F18: rejects a non-numeric amount", () => {
    expect(() => parseCliArgs(["--usd", "lots"])).toThrow(/positive number/);
    expect(() => parseCliArgs(["--usd=-3"])).toThrow(/positive number/);
    // `--usd -3` is rejected earlier, by parseArgs itself, as an ambiguous argument.
    expect(() => parseCliArgs(["--usd", "-3"])).toThrow();
  });

  test("F18: rejects unknown flags rather than ignoring them", () => {
    expect(() => parseCliArgs(["--yolo"])).toThrow();
  });
});
