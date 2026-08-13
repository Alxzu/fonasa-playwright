import type { Scenario } from "./scenarios";

/**
 * Tier A hazard fixtures (plan §3.2).
 *
 * ⚠️  These are NOT ground truth. They are hand-authored from JSF/MyFaces rendering
 * conventions and deliberately written to be HOSTILE — nested wrapper tables, colon-prefixed
 * auto-generated ids, a hidden companion date field that precedes the visible input,
 * option values that differ from their labels, decoy links.
 *
 * What they prove: our selectors and step logic are not NAIVE — they survive the specific
 * failure modes JSF is known to produce.
 * What they do NOT prove: that any of it matches the real BPS page. Only the live-capture
 * session (plan §7) can do that, after which these become an overlay on captured markup.
 */

export interface RenderState {
  scenario: Scenario;
  periodo: string;
  monto: string;
  base: string;
  referencia: string;
  messages: string[];
}

const shell = (title: string, body: string, extraScript = "") => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>BPS - SNIS Profesionales - ${title}</title></head>
<body>
<div id="cabezal"><h1>Banco de Previsión Social</h1></div>
<form id="formulario" name="formulario" method="POST" action="/SnisProfesionalesWeb/paginas/anticipos/snisAnticiposAInicio.jsf">
<input type="hidden" name="_action" id="_action" value="">
${body}
</form>
<script>
// JSF renders <h:commandLink> as an anchor that submits the form — not a submit button.
// Modelling this matters: a mock built from <button type=submit> would not exercise the
// same navigation path the real page uses.
function jsfSubmit(action) {
  document.getElementById('_action').value = action;
  document.getElementById('formulario').submit();
  return false;
}
${extraScript}
</script>
</body></html>`;

const messageBlock = (messages: string[]) =>
  messages.length === 0
    ? ""
    : `<ul class="rich-messages">${messages.map((m) => `<li>${m}</li>`).join("")}</ul>`;

const siguiente = `<a href="#" id="btnSiguiente" onclick="return jsfSubmit('siguiente')">Siguiente &gt;</a>`;

/**
 * Step 1 — Datos del Titular.
 *
 * Hazard (plan F12): the hidden companion state field precedes the visible input and its
 * id ends in `fechaNacimiento`, so an `input[name*="fecha"]`-style selector that does not
 * exclude hidden fields will fill the WRONG one and leave the visible field empty.
 * The server validates the hidden field, which only a dispatched `change` event syncs.
 */
export function renderStep1(state: RenderState): string {
  const syncsDate = state.scenario !== "hidden-date-not-submitted";
  const sync = syncsDate
    ? `document.getElementById('formulario:fechaNacimientoInputDate').addEventListener('change', function (e) {
         document.getElementById('formulario:fechaNacimiento').value = e.target.value;
       });`
    : `/* scenario hidden-date-not-submitted: the widget never syncs to the state field */`;

  return shell(
    "Datos del Titular",
    `${messageBlock(state.messages)}
<h2>Datos del Titular</h2>
<table id="formulario:j_id20" border="0"><tr><td>
  <table>
    <tr><td>Empresa</td><td>
      <input type="text" id="formulario:j_id23:empresa" name="formulario:j_id23:empresa" value=""></td></tr>
    <tr><td>RUT</td><td>
      <input type="text" id="formulario:j_id23:rut" name="formulario:j_id23:rut" value=""></td></tr>
    <tr><td>Documento</td><td>
      <input type="text" id="formulario:j_id23:documento" name="formulario:j_id23:documento" value=""></td></tr>
    <tr><td>Fecha de Nacimiento</td><td>
      <input type="hidden" id="formulario:fechaNacimiento" name="formulario:fechaNacimiento" value="">
      <input type="text" id="formulario:fechaNacimientoInputDate" name="formulario:fechaNacimientoInputDate" value="" size="10">
      <img alt="calendario" src="/img/calendar.gif" width="16" height="16">
    </td></tr>
  </table>
</td></tr></table>
${siguiente}`,
    sync
  );
}

/** Step 2 — Tipo Factura. The período here decides which month is invoiced (plan A3). */
export function renderStep2(state: RenderState): string {
  const options = ["01/2026", "05/2026", "06/2026", "07/2026", "08/2026", "12/2025"];
  if (!options.includes(state.periodo)) options.push(state.periodo);

  return shell(
    "Tipo Factura",
    `${messageBlock(state.messages)}
<h2>Tipo Factura</h2>
<table><tr><td>
  <table>
    <tr><td>Tipo</td><td>
      <select id="formulario:tipoFactura" name="formulario:tipoFactura">
        <option value="1" selected>Anticipos mensuales</option>
        <option value="2">Factura anual</option>
      </select></td></tr>
    <tr><td>Período</td><td>
      <select id="formulario:periodo" name="formulario:periodo">
        ${options
          .map((o) => `<option value="${o}"${o === state.periodo ? " selected" : ""}>${o}</option>`)
          .join("")}
      </select></td></tr>
  </table>
</td></tr></table>
${siguiente}`
  );
}

/**
 * Step 3 — Datos Factura.
 *
 * Hazards:
 *  - an outer wrapper <tr> whose text contains "Monto facturado" (plan A2 — this is what
 *    made the old `tr:has-text("Monto") input` fallback resolve to the empresa field);
 *  - the impuesto <select> uses numeric option VALUES with Spanish LABELS, so
 *    `selectOption("IRPF")` (which matches by value) fails and the label fallback is required;
 *  - under `jsf-id-collision`, a decoy `j_id460` field precedes the real `j_id46`.
 */
export function renderStep3(state: RenderState): string {
  const collision = state.scenario === "jsf-id-collision";
  const decoyRow =
    state.scenario === "amount-decoy-outer-row" || collision
      ? `<tr><td>Referencia de Monto facturado anterior<input type="text" id="formulario:decoy" name="formulario:decoy" value=""></td></tr>`
      : "";

  const montoField =
    state.scenario === "amount-field-renamed"
      ? `<span id="formulario:montoReadonly">(no editable)</span>`
      : collision
        ? `<input type="hidden" id="formulario:campoImporte0" name="formulario:j_id460" value="">
           <input type="text" id="formulario:campoImporte" name="formulario:j_id46" value="">`
        : `<input type="text" id="formulario:montoFacturado" name="formulario:montoFacturado" value=""${
            state.scenario === "amount-reformatted" ? ' data-reformat="true"' : ""
          }>`;

  const fechaPagoField =
    state.scenario === "calendar-missing"
      ? `<span>(la fecha de pago se asigna automáticamente)</span>`
      : `<input type="text" id="formulario:fechaPago" name="formulario:fechaPago" value="" size="10">
         <img alt="calendario" src="/img/calendar.gif">`;

  // A JSF client-side converter that mangles the value after it is set — the exact case
  // the read-back in fillRequired exists to catch (plan F1).
  const reformatScript =
    state.scenario === "amount-reformatted"
      ? `document.querySelector('[data-reformat]').addEventListener('change', function (e) {
           e.target.value = '0';
         });`
      : "";

  return shell(
    "Datos Factura",
    `${messageBlock(state.messages)}
<h2>Datos Factura</h2>
<table id="formulario:wrapper"><tr><td>Detalle de Monto facturado y Base de cálculo del período
  <table>
    ${decoyRow}
    <tr><td>Impuesto</td><td>
      <select id="formulario:impuesto" name="formulario:impuesto">
        <option value="1" selected>IRPF</option>
        <option value="2">IRAE</option>
        <option value="3">IRPF e IRAE</option>
      </select></td></tr>
    <tr><td>Monto facturado</td><td>${montoField}</td></tr>
    <tr><td>Base de cálculo</td><td>
      <input type="text" id="formulario:baseCalculo" name="formulario:baseCalculo" alt="profImporte" value=""></td></tr>
    <tr><td>Fecha de pago</td><td>${fechaPagoField}</td></tr>
  </table>
</td></tr></table>
<a href="#" id="btnConfirmar" onclick="return jsfSubmit('confirmar')">Confirmar</a>`,
    reformatScript
  );
}

/** Step 4 — the results page, and the terminal read-back surface (plan A4). */
export function renderStep4(state: RenderState): string {
  const ref = state.referencia;
  const payHref =
    state.scenario === "link-no-ref"
      ? "https://pagos.example/pagar"
      : `https://pagos.example/pagar?ref=${ref}`;

  const duplicate =
    state.scenario === "duplicate-pagar-link"
      ? `<div id="nav"><a href="/ayuda/pagos">Pagar Factura - ayuda</a></div>`
      : "";

  const montoMostrado =
    state.scenario === "confirm-amount-mismatch" ? String(Number(state.monto) + 1000) : state.monto;

  return shell(
    "Factura generada",
    `${duplicate}
<h2>Factura generada</h2>
<table>
  <tr><td>Referencia</td><td id="formulario:referencia">${ref}</td></tr>
  <tr><td>Monto</td><td id="formulario:montoConfirmado">${montoMostrado}</td></tr>
  <tr><td>Base de cálculo</td><td id="formulario:baseConfirmada">${state.base}</td></tr>
  <tr><td>Período</td><td id="formulario:periodoConfirmado">${state.periodo}</td></tr>
</table>
<a id="pagar" href="${payHref}">Pagar Factura</a>
<a id="descargar" href="/factura/descargar?f=${ref}">Imprimir o Descargar Factura</a>`
  );
}
