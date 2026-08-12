import type { Config } from "./types";

export const config: Config = {
  // Company Data
  empresa: process.env.BPS_EMPRESA || "",
  rut: process.env.BPS_RUT || "",

  // Holder Data
  documento: process.env.BPS_DOCUMENTO || "",
  fechaNacimiento: process.env.BPS_FECHA_NAC || "", // Format: DD/MM/YYYY

  // Invoice Settings
  impuesto: process.env.BPS_IMPUESTO || "IRPF", // IRPF, IRAE, IRPF e IRAE

  // Amount in USD (will be converted to UYU)
  montoUSD: Number(process.env.BPS_MONTO_USD) || 0,

  // Exchange rate API
  exchangeRateAPI:
    process.env.EXCHANGE_RATE_API || "https://bcu.alxzu.duckdns.org/api/v2/rates/usd-cash",

  // Output
  outputDir: process.env.OUTPUT_DIR || "./output",

  // Browser settings
  headless: process.env.HEADLESS !== "false"
};

const DATE_FORMAT_REGEX = /^\d{2}\/\d{2}\/\d{4}$/;

/**
 * Validate that all required configuration is present and properly formatted
 */
export function validateConfig(): void {
  const required: Array<{ key: keyof Config; value: unknown }> = [
    { key: "empresa", value: config.empresa },
    { key: "rut", value: config.rut },
    { key: "documento", value: config.documento },
    { key: "fechaNacimiento", value: config.fechaNacimiento },
    { key: "montoUSD", value: config.montoUSD }
  ];

  const missing = required.filter((r) => !r.value);
  if (missing.length > 0) {
    throw new Error(
      `Missing required configuration: ${missing.map((m) => m.key).join(", ")}\n` +
        `Please check your .env file.`
    );
  }

  // Validate date format (DD/MM/YYYY)
  if (!DATE_FORMAT_REGEX.test(config.fechaNacimiento)) {
    throw new Error(
      `Invalid date format for BPS_FECHA_NAC: "${config.fechaNacimiento}"\n` +
        `Expected format: DD/MM/YYYY (e.g., 17/07/1990)`
    );
  }

  // Validate amount is positive
  if (config.montoUSD <= 0) {
    throw new Error(
      `Invalid amount for BPS_MONTO_USD: ${config.montoUSD}\n` + `Amount must be a positive number.`
    );
  }
}
