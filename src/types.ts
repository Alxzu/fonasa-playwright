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
}

export interface InvoiceResult {
  referencia: string;
  montoUSD: number;
  exchangeRate: number;
  exchangeDate: string;
  montoUYU: number;
  baseCalculo: number;
  fechaPago: string;
  paymentLink: string;
  pdfPath: string;
}

export interface InvoiceExtraction {
  referencia: string;
  paymentLink: string;
  pdfPath: string;
}

export interface Config {
  empresa: string;
  rut: string;
  documento: string;
  fechaNacimiento: string;
  impuesto: string;
  montoUSD: number;
  exchangeRateAPI: string;
  outputDir: string;
  headless: boolean;
}
