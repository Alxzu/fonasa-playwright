import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { ALL_SCENARIOS } from "../mock-bps/scenarios";
import { cleanup, createHarness, EXPECTED_UYU, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

/**
 * One test per row of the plan's §3.4 scenario table.
 *
 * Each asserts a NAMED exception, not a generic failure. The distinction matters: the
 * whole point of the rewrite is that a run either produces a correct invoice or says
 * precisely what went wrong — "it threw something" is not the bar.
 */

const TIMEOUT = 60_000;

describe("F1 — an unfillable or unstuck amount is fatal", () => {
  test(
    "E2E-02 amount-field-renamed: throws and never clicks Confirmar",
    async () => {
      const { error, submission, outputDir } = await h.run("amount-field-renamed");
      try {
        expect(error).toBeDefined();
        expect(error?.name).toBe("SelectorError");
        expect(error?.message).toMatch(/monto facturado/);
        expect(error?.message).toMatch(/no selector matched/);

        // The original code did nothing on a miss and then confirmed anyway — that is the
        // whole finding. Prove step 3 was never submitted.
        expect(submission["formulario:montoFacturado"]).toBeUndefined();
        expect(submission["formulario:baseCalculo"]).toBeUndefined();
      } finally {
        cleanup(outputDir);
      }
    },
    TIMEOUT
  );

  test(
    "E2E-03 amount-reformatted: a converter that mangles the value is caught",
    async () => {
      const { error, outputDir } = await h.run("amount-reformatted");
      try {
        expect(error?.name).toBe("VerificationError");
        expect(error?.message).toMatch(/did not stick/);
        expect(error?.message).toMatch(/40000/);
      } finally {
        cleanup(outputDir);
      }
    },
    TIMEOUT
  );
});

describe("A1/A2 — the amount reaches the right field on hostile markup", () => {
  test(
    "E2E-04 amount-decoy-outer-row: a wrapper row containing the label does not divert it",
    async () => {
      const { result, error, submission, outputDir } = await h.run("amount-decoy-outer-row");
      try {
        expect(error).toBeUndefined();
        expect(result?.montoUYU).toBe(EXPECTED_UYU);
        expect(submission["formulario:montoFacturado"]).toBe(String(EXPECTED_UYU));
        // The decoy field must be untouched.
        expect(submission["formulario:decoy"]).toBe("");
      } finally {
        cleanup(outputDir);
      }
    },
    TIMEOUT
  );

  test(
    "E2E-05 jsf-id-collision: j_id460 does not capture the j_id46 entry",
    async () => {
      const { error, submission, outputDir } = await h.run("jsf-id-collision");
      try {
        expect(error).toBeUndefined();
        expect(submission["formulario:j_id46"]).toBe(String(EXPECTED_UYU));
        expect(submission["formulario:j_id460"]).toBe("");
      } finally {
        cleanup(outputDir);
      }
    },
    TIMEOUT
  );
});

describe("F2 — the payment date is never fabricated", () => {
  test(
    "E2E-06 calendar-missing: reports null rather than today's date",
    async () => {
      const { result, error, outputDir } = await h.run("calendar-missing");
      try {
        expect(error).toBeUndefined();
        // The original returned formatDateES(today) unconditionally, so the summary claimed
        // a payment date the form never carried.
        expect(result?.fechaPago).toBeNull();

        const saved = JSON.parse(fs.readFileSync(`${outputDir}/result_07-2026.json`, "utf8"));
        expect(saved.fechaPago).toBeNull();
      } finally {
        cleanup(outputDir);
      }
    },
    TIMEOUT
  );
});

describe("F12 — the date of birth must reach the hidden state field", () => {
  test(
    "E2E-07 hidden-date-not-submitted: the rejected postback surfaces as a named error",
    async () => {
      const { error, outputDir } = await h.run("hidden-date-not-submitted");
      try {
        expect(error?.name).toBe("JsfValidationError");
        expect(error?.message).toMatch(/step 1/);
        expect(error?.message).toMatch(/Fecha de Nacimiento/);
      } finally {
        cleanup(outputDir);
      }
    },
    TIMEOUT
  );
});

describe("F6 — a failed JSF postback re-renders the same page", () => {
  test(
    "E2E-08 validation-error-step1: named, with the server's own message",
    async () => {
      const { error, outputDir } = await h.run("validation-error-step1");
      try {
        expect(error?.name).toBe("JsfValidationError");
        expect(error?.message).toMatch(/BPS rejected step 1/);
        expect(error?.message).toMatch(/no corresponde a un afiliado activo/);
        // The failure mode being prevented: networkidle resolves, step 2 runs its selectors
        // against step 1's DOM, and the real cause is lost.
        expect(error?.message).not.toMatch(/período/);
      } finally {
        cleanup(outputDir);
      }
    },
    TIMEOUT
  );

  test(
    "E2E-09 validation-error-step3: named at step 3, not step 4",
    async () => {
      const { error, outputDir } = await h.run("validation-error-step3");
      try {
        expect(error?.name).toBe("JsfValidationError");
        expect(error?.message).toMatch(/BPS rejected step 3/);
        expect(error?.message).toMatch(/excede el máximo permitido/);
      } finally {
        cleanup(outputDir);
      }
    },
    TIMEOUT
  );
});

describe("A3 — the período is verified, not assumed", () => {
  test(
    "E2E-10 period-unexpected-default: refuses to invoice the wrong month",
    async () => {
      const { error, submission, outputDir } = await h.run("period-unexpected-default");
      try {
        expect(error?.name).toBe("VerificationError");
        expect(error?.message).toMatch(/Período mismatch/);
        expect(error?.message).toMatch(/01\/2026/);
        expect(error?.message).toMatch(/07\/2026/);
        // Nothing was ever confirmed.
        expect(submission["formulario:montoFacturado"]).toBeUndefined();
      } finally {
        cleanup(outputDir);
      }
    },
    TIMEOUT
  );
});

describe("A4 — the terminal read-back", () => {
  test(
    "E2E-11 confirm-amount-mismatch: catches a discrepancy after confirmation",
    async () => {
      const { error, outputDir } = await h.run("confirm-amount-mismatch");
      try {
        expect(error?.name).toBe("VerificationError");
        expect(error?.message).toMatch(/Invoice amount mismatch/);
        expect(error?.message).toMatch(/41000/);
        expect(error?.message).toMatch(/40000/);
        // The invoice already exists at this point, so the message must say so.
        expect(error?.message).toMatch(/already been created/);
      } finally {
        cleanup(outputDir);
      }
    },
    TIMEOUT
  );
});

describe("F4 / F8 — the payment link", () => {
  test(
    "E2E-12 link-no-ref: throws and writes no FacturaBPS_.pdf",
    async () => {
      const { error, outputDir } = await h.run("link-no-ref");
      try {
        expect(error?.name).toBe("VerificationError");
        expect(error?.message).toMatch(/Could not extract a reference/);
        // The original saved "FacturaBPS_.pdf" and printed SUCCESS with a blank reference.
        expect(fs.existsSync(`${outputDir}/FacturaBPS_.pdf`)).toBe(false);
        expect(fs.readdirSync(outputDir)).toHaveLength(0);
      } finally {
        cleanup(outputDir);
      }
    },
    TIMEOUT
  );

  test(
    "E2E-13 duplicate-pagar-link: no strict-mode crash, correct href",
    async () => {
      const { result, error, outputDir } = await h.run("duplicate-pagar-link");
      try {
        expect(error).toBeUndefined();
        expect(result?.paymentLink).toContain(`ref=${result?.referencia}`);
        expect(result?.paymentLink).not.toContain("/ayuda/");
      } finally {
        cleanup(outputDir);
      }
    },
    TIMEOUT
  );
});

describe("F14 — the download must actually be an invoice", () => {
  test(
    "E2E-14 pdf-zero-bytes: rejected on size",
    async () => {
      const { error, outputDir } = await h.run("pdf-zero-bytes");
      try {
        expect(error?.name).toBe("VerificationError");
        expect(error?.message).toMatch(/only 0 bytes/);
      } finally {
        cleanup(outputDir);
      }
    },
    TIMEOUT
  );

  test(
    "E2E-15 pdf-is-html-error: rejected on magic bytes",
    async () => {
      const { error, outputDir } = await h.run("pdf-is-html-error");
      try {
        expect(error?.name).toBe("VerificationError");
        expect(error?.message).toMatch(/not a PDF|only \d+ bytes/);
      } finally {
        cleanup(outputDir);
      }
    },
    TIMEOUT
  );
});

describe("F13 — failure artifacts", () => {
  test(
    "E2E-21: writes screenshot, scrubbed HTML, note and trace — with no PII",
    async () => {
      const { error, artifacts, outputDir } = await h.run("validation-error-step1", {
        captureArtifacts: true
      });
      try {
        expect(error).toBeDefined();
        expect(artifacts.some((f) => f.endsWith(".png"))).toBe(true);
        expect(artifacts.some((f) => f.endsWith(".html"))).toBe(true);
        expect(artifacts.some((f) => f.endsWith(".zip"))).toBe(true);

        const htmlPath = artifacts.find((f) => f.endsWith(".html")) as string;
        const html = fs.readFileSync(htmlPath, "utf8");

        // The reason this matters: JSF re-renders echo submitted values back into
        // value="…" attributes, so an unscrubbed error page carries documento/RUT/DOB into
        // whatever tooling or agent reads it later.
        expect(html).not.toContain("11111111"); // documento
        expect(html).not.toContain("123456789012"); // RUT
        expect(html).not.toContain("17/07/1990"); // fecha de nacimiento

        // …while staying useful for selector repair.
        expect(html).toContain("formulario:j_id23:documento");
        expect(html).toContain("rich-messages");

        const trace = artifacts.find((f) => f.endsWith(".zip")) as string;
        expect(fs.statSync(trace).size).toBeGreaterThan(0);
      } finally {
        cleanup(outputDir);
      }
    },
    TIMEOUT
  );
});

describe("E2E-18 / F9 — no fixed sleeps survive in src/", () => {
  test("src/ contains no waitForTimeout calls", async () => {
    // The original had eight, at 300–1000ms each. They made the script fast when BPS was
    // fast and flaky when it was slow; every one is now an anchored wait.
    const files = new Bun.Glob("**/*.ts").scanSync({ cwd: "src" });
    const offenders: string[] = [];
    for (const file of files) {
      const source = await Bun.file(`src/${file}`).text();
      // Match the CALL, so prose about the ban does not trip its own assertion.
      if (source.includes("waitForTimeout(")) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

describe("scenario coverage", () => {
  test("every scenario in the registry is exercised by a test in this suite", async () => {
    // Guards against adding a hazard to the mock and forgetting to assert against it.
    const suite = await Bun.file(import.meta.path).text();
    const untested = ALL_SCENARIOS.filter(
      (scenario) =>
        scenario !== "happy" && scenario !== "slow-postback" && !suite.includes(scenario)
    );
    expect(untested).toEqual([]);
  });
});
