export interface ExchangeRateResponse {
  currency: {
    slug: string;
    name: string;
  };
  date: string;
  rates: {
    buy: number;
    sell: number;
  };
  source: string;
}

export interface ExchangeRateError {
  error: string;
  currency?: string;
  date?: string;
  suggestion?: string;
}

export interface ExchangeRate {
  rate: number;
  date: string;
  /** Which leg of the quote was used. Explicit so changing it is a visible act (plan F5). */
  leg: "buy" | "sell";
}

/**
 * The three legal values of the impuesto select (plan F21).
 * Kept as a const tuple so it is both a type and a runtime list for validation.
 */
export const IMPUESTOS = ["IRPF", "IRAE", "IRPF e IRAE"] as const;
export type Impuesto = (typeof IMPUESTOS)[number];

export interface InvoiceResult {
  referencia: string;
  montoUSD: number;
  exchangeRate: number;
  exchangeDate: string;
  exchangeLeg: "buy" | "sell";
  montoUYU: number;
  baseCalculo: number;
  /**
   * Null when the payment date could not be read back off the form (plan F2).
   * It is NEVER locally fabricated — a summary that claims a date the form does not
   * carry is exactly the silent-wrong-result failure this project is guarding against.
   */
  fechaPago: string | null;
  /** The período the form said it was invoicing, read back and asserted (plan A3). */
  periodo: string;
  paymentLink: string;
  pdfPath: string;
  /** ISO timestamp, stamped when the run completed. */
  generatedAt: string;
}

export interface InvoiceExtraction {
  referencia: string;
  paymentLink: string;
  pdfPath: string;
  /** Monto as displayed on the results page, for the terminal assertion (plan A4). */
  montoConfirmado: number;
}

export interface Config {
  empresa: string;
  rut: string;
  documento: string;
  fechaNacimiento: string;
  impuesto: Impuesto;
  montoUSD: number;
  exchangeRateAPI: string;
  /** Promoted from a hardcoded constant so the mock BPS can be targeted (plan §4.4). */
  formUrl: string;
  outputDir: string;
  headless: boolean;
  /** Overwrite an existing result for the same período (plan A6). */
  force: boolean;
  /** Compute and print, but never open a browser. */
  dryRun: boolean;
}
