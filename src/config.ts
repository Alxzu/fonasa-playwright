import { type Config, IMPUESTOS, type Impuesto } from "./types";
import { isValidCedula, isValidRut } from "./utils/check-digits";

export const DEFAULT_FORM_URL =
  "https://app1.bps.gub.uy/SnisProfesionalesWeb/paginas/anticipos/snisAnticiposAInicio.jsf";

const DATE_FORMAT_REGEX = /^(\d{2})\/(\d{2})\/(\d{4})$/;

export interface CliOverrides {
  usd?: number;
  force?: boolean;
  dryRun?: boolean;
  outputDir?: string;
}

/**
 * Build config from the environment plus CLI overrides (plan F18).
 *
 * Takes `env` as a parameter rather than reading `process.env` at module scope, so
 * validation is testable without mutating the real environment (spec CF-*).
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  overrides: CliOverrides = {}
): Config {
  return {
    empresa: env.BPS_EMPRESA ?? "",
    rut: env.BPS_RUT ?? "",
    documento: env.BPS_DOCUMENTO ?? "",
    fechaNacimiento: env.BPS_FECHA_NAC ?? "",
    impuesto: (env.BPS_IMPUESTO ?? "IRPF") as Impuesto,
    montoUSD: overrides.usd ?? Number(env.BPS_MONTO_USD ?? Number.NaN),
    exchangeRateAPI: env.EXCHANGE_RATE_API ?? "https://bcu.alxzu.duckdns.org/api/v2/rates/usd-cash",
    formUrl: env.BPS_FORM_URL ?? DEFAULT_FORM_URL,
    outputDir: overrides.outputDir ?? env.OUTPUT_DIR ?? "./output",
    headless: env.HEADLESS !== "false",
    force: overrides.force ?? false,
    dryRun: overrides.dryRun ?? false
  };
}

/** A real calendar date, not merely DD/MM/YYYY-shaped (spec CF-03). */
function isRealDate(value: string): boolean {
  const match = DATE_FORMAT_REGEX.exec(value);
  if (!match) return false;
  const [, dd, mm, yyyy] = match as unknown as [string, string, string, string];
  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/**
 * Fail at config time rather than 30 seconds into a browser run.
 * Returns non-fatal warnings; throws on anything that would produce a wrong invoice.
 */
export function validateConfig(config: Config): string[] {
  const warnings: string[] = [];

  const required: Array<[keyof Config, unknown]> = [
    ["empresa", config.empresa],
    ["rut", config.rut],
    ["documento", config.documento],
    ["fechaNacimiento", config.fechaNacimiento]
  ];
  const missing = required.filter(([, value]) => !value).map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(
      `Missing required configuration: ${missing.join(", ")}\nPlease check your .env file.`
    );
  }

  if (!isRealDate(config.fechaNacimiento)) {
    throw new Error(
      `Invalid date for BPS_FECHA_NAC: "${config.fechaNacimiento}"\n` +
        `Expected a real date as DD/MM/YYYY (e.g. 17/07/1990).`
    );
  }

  if (!Number.isFinite(config.montoUSD) || config.montoUSD <= 0) {
    throw new Error(
      `Invalid amount for BPS_MONTO_USD: ${config.montoUSD}\nAmount must be a positive number.`
    );
  }

  // Plan F21: an invalid value here fails cryptically inside selectOption at step 3.
  if (!IMPUESTOS.includes(config.impuesto)) {
    throw new Error(
      `Invalid BPS_IMPUESTO: "${config.impuesto}"\nExpected one of: ${IMPUESTOS.join(", ")}`
    );
  }

  if (!/^https?:\/\//.test(config.formUrl)) {
    throw new Error(`Invalid BPS_FORM_URL: "${config.formUrl}"`);
  }

  // Plan CD-04: warn only — an unconfirmed check-digit table must never block a valid run.
  if (!isValidCedula(config.documento)) {
    warnings.push(
      `BPS_DOCUMENTO "${config.documento}" fails the cédula check digit — possible typo. ` +
        `(This check is unconfirmed against real values; see docs/IMPROVEMENT_PLAN.md §8.4.)`
    );
  }
  if (!isValidRut(config.rut)) {
    warnings.push(
      `BPS_RUT "${config.rut}" fails the RUT check digit — possible typo. ` +
        `(This check is unconfirmed against real values; see docs/IMPROVEMENT_PLAN.md §8.4.)`
    );
  }

  return warnings;
}
