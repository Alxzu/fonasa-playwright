import { makeHtmlErrorPage, makePdf } from "./pdf";
import { type RenderState, renderStep1, renderStep2, renderStep3, renderStep4 } from "./render";
import { isScenario, type Scenario } from "./scenarios";

/**
 * A mock BPS that is a STATE MACHINE, not a static file server (plan §3.2, §3.5).
 *
 * The behaviours it models are the ones that actually bite:
 *   1. command links submit the form (JSF renders <h:commandLink> as an anchor);
 *   2. a failed validation re-renders the SAME url and the SAME step with a message block —
 *      it never redirects. This is precisely why `networkidle` resolving proves nothing;
 *   3. server-side state lives in a hidden field, and validation reads the HIDDEN field,
 *      not the visible input — which is what makes plan F12 testable instead of guesswork;
 *   4. submitted values echo back into `value="…"` attributes on re-render, so the PII
 *      scrubber has something real to scrub.
 */

const FORM_PATH = "/SnisProfesionalesWeb/paginas/anticipos/snisAnticiposAInicio.jsf";
const SLOW_MS = 1_200;

interface Session extends RenderState {
  step: 1 | 2 | 3 | 4;
  fields: Record<string, string>;
}

export interface MockOptions {
  /** Fixed clock so the expected período is deterministic in tests. */
  today: Date;
  port?: number;
}

export interface MockServer {
  url: string;
  port: number;
  stop: () => Promise<void>;
  /** Everything the last completed run submitted — lets tests assert what BPS actually received. */
  lastSubmission: () => Record<string, string>;
}

function expectedPeriodo(today: Date): string {
  const lastDay = new Date(today.getFullYear(), today.getMonth(), 0);
  return `${String(lastDay.getMonth() + 1).padStart(2, "0")}/${lastDay.getFullYear()}`;
}

const html = (body: string) =>
  new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });

export function startMockBps(options: MockOptions): MockServer {
  const sessions = new Map<string, Session>();
  let lastSubmission: Record<string, string> = {};
  let nextRef = 900_001;
  let nextSid = 1;

  const newSession = (scenario: Scenario): Session => ({
    step: 1,
    scenario,
    periodo: scenario === "period-unexpected-default" ? "01/2026" : expectedPeriodo(options.today),
    monto: "",
    base: "",
    referencia: "",
    messages: [],
    fields: {}
  });

  const render = (session: Session): Response => {
    const body =
      session.step === 1
        ? renderStep1(session)
        : session.step === 2
          ? renderStep2(session)
          : session.step === 3
            ? renderStep3(session)
            : renderStep4(session);
    session.messages = [];
    return html(body);
  };

  const server = Bun.serve({
    port: options.port ?? 0,
    async fetch(request) {
      const url = new URL(request.url);

      // ── session ────────────────────────────────────────────────────────────────────
      const cookie = request.headers.get("cookie") ?? "";
      let sid = /mocksid=([^;]+)/.exec(cookie)?.[1];
      let setCookie: string | undefined;
      if (!sid || !sessions.has(sid)) {
        sid = String(nextSid++);
        const requested = url.searchParams.get("scenario") ?? "happy";
        sessions.set(sid, newSession(isScenario(requested) ? requested : "happy"));
        setCookie = `mocksid=${sid}; Path=/`;
      }
      const session = sessions.get(sid) as Session;

      if (session.scenario === "slow-postback") await Bun.sleep(SLOW_MS);

      const respond = (response: Response) => {
        if (setCookie) response.headers.set("set-cookie", setCookie);
        return response;
      };

      // ── PDF download ───────────────────────────────────────────────────────────────
      if (url.pathname === "/factura/descargar") {
        const ref = url.searchParams.get("f") ?? "0";
        const bytes =
          session.scenario === "pdf-zero-bytes"
            ? new Uint8Array(new ArrayBuffer(0))
            : session.scenario === "pdf-is-html-error"
              ? makeHtmlErrorPage()
              : makePdf(ref);
        return respond(
          // Wrapped in a Blob: a bare Uint8Array is not a `BodyInit` under lib.dom.
          new Response(new Blob([bytes]), {
            headers: {
              "content-type": "application/pdf",
              "content-disposition": `attachment; filename="FacturaBPS_${ref}.pdf"`
            }
          })
        );
      }

      if (url.pathname !== FORM_PATH) {
        return respond(new Response("Not found", { status: 404 }));
      }

      // ── GET: start over at step 1 ──────────────────────────────────────────────────
      if (request.method === "GET") {
        const requested = url.searchParams.get("scenario");
        if (requested && isScenario(requested)) {
          sessions.set(sid, newSession(requested));
          return respond(render(sessions.get(sid) as Session));
        }
        session.step = 1;
        return respond(render(session));
      }

      // ── POST: a JSF postback ───────────────────────────────────────────────────────
      const form = await request.formData();
      const fields: Record<string, string> = {};
      for (const [key, value] of form.entries()) {
        if (typeof value === "string") fields[key] = value;
      }
      Object.assign(session.fields, fields);
      lastSubmission = { ...session.fields };

      const errors = validate(session, fields);
      if (errors.length > 0) {
        // Re-render the SAME step with messages. No redirect, same URL, 200 OK.
        session.messages = errors;
        return respond(render(session));
      }

      if (session.step === 1) {
        session.step = 2;
      } else if (session.step === 2) {
        session.periodo = fields["formulario:periodo"] ?? session.periodo;
        session.step = 3;
      } else if (session.step === 3) {
        session.monto = fields["formulario:montoFacturado"] ?? fields["formulario:j_id46"] ?? "";
        session.base = fields["formulario:baseCalculo"] ?? "";
        session.referencia = String(nextRef++);
        session.step = 4;
      }

      return respond(render(session));
    }
  });

  const port = server.port ?? 0;
  return {
    url: `http://localhost:${port}${FORM_PATH}`,
    port,
    stop: async () => {
      await server.stop(true);
    },
    lastSubmission: () => lastSubmission
  };
}

/** Server-side validation — deliberately checks the HIDDEN date field (plan F12). */
function validate(session: Session, fields: Record<string, string>): string[] {
  const errors: string[] = [];

  if (session.step === 1) {
    if (session.scenario === "validation-error-step1") {
      return ["El documento ingresado no corresponde a un afiliado activo."];
    }
    for (const [name, label] of [
      ["formulario:j_id23:empresa", "Empresa"],
      ["formulario:j_id23:rut", "RUT"],
      ["formulario:j_id23:documento", "Documento"]
    ] as const) {
      if (!fields[name]?.trim()) errors.push(`El campo ${label} es obligatorio.`);
    }
    // The visible input is presentation only. If the widget did not sync it to the
    // hidden state field, the postback carries nothing — exactly the F12 failure.
    if (!fields["formulario:fechaNacimiento"]?.trim()) {
      errors.push("La Fecha de Nacimiento es obligatoria.");
    }
  }

  if (session.step === 3) {
    if (session.scenario === "validation-error-step3") {
      return ["El monto facturado excede el máximo permitido para el período."];
    }
    const monto = fields["formulario:montoFacturado"] ?? fields["formulario:j_id46"] ?? "";
    if (!/^\d+$/.test(monto) || Number(monto) <= 0) {
      errors.push("El Monto facturado debe ser un número mayor a cero.");
    }
    const base = fields["formulario:baseCalculo"] ?? "";
    if (!/^\d+$/.test(base) || Number(base) <= 0) {
      errors.push("La Base de cálculo debe ser un número mayor a cero.");
    }
  }

  return errors;
}
