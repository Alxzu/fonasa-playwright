/**
 * The single mutation surface for BPS markup (plan F15, §4.5).
 *
 * ── Why arrays, not comma-joined CSS ──────────────────────────────────────────────────
 * These are ORDERED cascades, iterated one candidate at a time. That is not cosmetic.
 * `page.locator('a, b, c').first()` resolves the CSS union and picks by DOCUMENT ORDER,
 * so the apparent "primary → fallback" priority does not exist (plan A1, proved in §10 of
 * the plan). Every consumer must use `resolve()` / `fillRequired()` from utils/dom.ts,
 * never a comma-joined string.
 *
 * ── @bps-unverified ───────────────────────────────────────────────────────────────────
 * Selectors marked `@bps-unverified` are educated guesses from JSF/MyFaces conventions and
 * from the pre-existing code. They are exercised against the Tier A hazard fixtures and the
 * mock BPS, which proves they are not NAIVE — it does not prove they match the real page.
 * The live-capture session (plan §7) retires each marker.
 */

export interface Cascade {
  /** Ordered candidates: earlier entries win. */
  candidates: readonly string[];
  /** Human label used in diagnostics when nothing matches. */
  label: string;
  /** False until confirmed against captured markup in the live-capture session. */
  verified: boolean;
}

const cascade = (label: string, candidates: readonly string[], verified = false): Cascade => ({
  label,
  candidates,
  verified
});

export const selectors = {
  step1: {
    empresa: cascade("empresa", [
      'input[id$="empresa"]',
      'input[name*="empresa"]',
      // @bps-unverified — role name comes from the pre-existing code
      'role=textbox[name="empresa"i]'
    ]),
    rut: cascade("RUT", ['input[id$="rut"]', 'input[name*="rut"]', 'role=textbox[name="rut"i]']),
    documento: cascade("documento", [
      'input[id$="documento"]',
      'input[name*="documento"]',
      'role=textbox[name="documento"i]'
    ]),
    /**
     * The DOB cascade must select the VISIBLE input. JSF date widgets keep a hidden
     * companion state field whose name also contains "fecha", and it can precede the
     * visible one in the DOM (plan F12, spec SL-04) — hence `:not([type=hidden])` first.
     */
    fechaNacimiento: cascade("fecha de nacimiento", [
      'input[id$="fechaNacimiento"]:not([type="hidden"])',
      'input[name*="fechaNacimiento"]:not([type="hidden"])',
      'input[name*="fechNac"]:not([type="hidden"])',
      'input[name*="nacimiento"]:not([type="hidden"])',
      'input[name*="fecha"]:not([type="hidden"])'
    ]),
    arrival: cascade("step 1 (Datos del Titular)", [
      'text="Datos del Titular"',
      'input[name*="documento"]'
    ])
  },

  step2: {
    /** Read back, never assumed (plan A3). */
    periodo: cascade("período", [
      'select[id$="periodo"]',
      'select[name*="periodo"]',
      'input[id$="periodo"]',
      'input[name*="periodo"]',
      '[id$="periodo"]'
    ]),
    tipoFactura: cascade("tipo de factura", [
      'select[id$="tipoFactura"]',
      'select[name*="tipoFactura"]',
      'input[name*="tipoFactura"][checked]',
      'input[name*="tipo"]:checked'
    ]),
    arrival: cascade("step 2 (Tipo Factura)", ['text="Tipo Factura"', '[id$="periodo"]'])
  },

  step3: {
    impuesto: cascade("impuesto", ['select[id$="impuesto"]', 'select[name*="impuesto"]', "select"]),
    /**
     * NOTE the ordering change from the original code: an exact id suffix beats the
     * `j_id46` substring, because `input[name*="j_id46"]` also matches `j_id460`,
     * `j_id461`, … (plan A2). The `tr:has-text(...)` fallbacks that used to be here are
     * GONE — on nested JSF tables they match an ancestor row and resolve to the first
     * input on the page, which meant the invoice amount could land in the empresa field.
     */
    monto: cascade("monto facturado", [
      'input[id$="montoFacturado"]',
      'input[id$="monto"]',
      'input[name$="monto"]',
      // Suffix, NOT substring: `[name*="j_id46"]` also matches j_id460, j_id461, … and
      // `.first()` would then pick whichever came first in the DOM (plan A2). Found by
      // building the `jsf-id-collision` hazard fixture.
      'input[name$="j_id46"]'
    ]),
    baseCalculo: cascade("base de cálculo", [
      'input[id$="baseCalculo"]',
      'input[id$="base"]',
      'input[name$="base"]',
      'input[alt*="profImporte"]'
    ]),
    fechaPago: cascade("fecha de pago", [
      'input[id$="fechaPago"]:not([type="hidden"])',
      'input[name*="fechaPago"]:not([type="hidden"])',
      'input[name*="pago"]:not([type="hidden"])'
    ]),
    arrival: cascade("step 3 (Datos Factura)", ['text="Datos Factura"', '[id$="monto"]'])
  },

  step4: {
    /**
     * Order matters here in a way that is easy to get wrong.
     * A bare `a[href*="ref="]` would also match the PDF download link, and a bare
     * text/role match would also match an unrelated "Pagar Factura" nav link in the page
     * header. Requiring both signals first disambiguates; the looser candidates remain as
     * fallbacks so a markup change degrades instead of failing outright.
     */
    paymentLink: cascade("Pagar Factura link", [
      'a[href*="ref="]:has-text("Pagar")',
      "role=link[name=/pagar factura/i]",
      'a[href*="ref="]'
    ]),
    downloadLink: cascade("Imprimir o Descargar Factura link", [
      "role=link[name=/imprimir o descargar/i]",
      'a:has-text("Descargar")'
    ]),
    /** For the terminal read-back assertion (plan A4). */
    montoConfirmado: cascade("monto on the results page", [
      '[id$="montoConfirmado"]',
      '[id$="monto"]',
      'td:has-text("Monto") + td'
    ]),
    referencia: cascade("referencia on the results page", [
      '[id$="referencia"]',
      'td:has-text("Referencia") + td'
    ]),
    periodo: cascade("período on the results page", [
      '[id$="periodoConfirmado"]',
      '[id$="periodo"]'
    ]),
    arrival: cascade("step 4 (results)", ['text="Factura generada"', 'a[href*="ref="]'])
  },

  /** Navigation controls, shared across steps. */
  nav: {
    siguiente: cascade("Siguiente", [
      "role=link[name=/siguiente/i]",
      'a:has-text("Siguiente")',
      'input[value*="Siguiente"]'
    ]),
    confirmar: cascade("Confirmar", [
      "role=link[name=/confirmar/i]",
      'a:has-text("Confirmar")',
      'input[value*="Confirmar"]',
      'button:has-text("Confirmar")'
    ])
  },

  /**
   * JSF validation-message containers (plan F6).
   * A failed postback re-renders the SAME page, so `networkidle` resolving proves nothing.
   * The exact class depends on which component library BPS uses — capture it once from a
   * deliberately invalid submission (plan §7 item 2).
   */
  jsfErrors: cascade("JSF validation messages", [
    ".rich-messages li",
    ".rich-message",
    "span.iceMsgError",
    "[id$='messages'] li",
    ".error-message",
    'ul[class*="message"] li'
  ])
} as const;

/** Every cascade in the tree, for coverage reporting and the unverified-marker audit. */
export function allCascades(): Cascade[] {
  const found: Cascade[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if ("candidates" in node && "label" in node) {
      found.push(node as Cascade);
      return;
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(selectors);
  return found;
}
