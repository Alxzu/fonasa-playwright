/**
 * Synthetic PDF bytes for the mock BPS.
 *
 * Generated in code rather than committed as a fixture file: `.gitignore` contains `*.pdf`,
 * so a committed fixture PDF would be silently dropped from the repo (plan §3.3).
 *
 * Must exceed the MIN_PDF_BYTES threshold asserted by step 4 (plan F14), otherwise the
 * happy-path test would fail for the wrong reason.
 */
export function makePdf(referencia: string): Uint8Array<ArrayBuffer> {
  const body = `BT /F1 12 Tf 72 720 Td (Factura BPS FONASA - ref ${referencia}) Tj ET`;
  // Padding keeps the file comfortably over the 1000-byte sanity threshold. PDF readers
  // ignore `%` comment lines, and `%PDF` stays first so the magic-byte check still passes.
  const padding = `\n% ${"padding ".repeat(140)}\n`;

  const pdf = [
    "%PDF-1.4",
    padding,
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R" +
      "/Resources<</Font<</F1 5 0 R>>>>>>endobj",
    `4 0 obj<</Length ${body.length}>>stream\n${body}\nendstream endobj`,
    "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
    "trailer<</Root 1 0 R/Size 6>>",
    "%%EOF"
  ].join("\n");

  return new TextEncoder().encode(pdf);
}

/** A download that is really an HTML error page — what BPS serves when a session expires. */
export function makeHtmlErrorPage(): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    "<html><body><h1>Error del sistema</h1><p>Su sesión ha expirado.</p></body></html>"
  );
}
