import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import {
  cleanup,
  createHarness,
  EXPECTED_BASE,
  EXPECTED_PERIODO,
  EXPECTED_UYU,
  type Harness,
  MONTO_USD
} from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

describe("E2E-01: the happy path, end to end against the mock BPS", () => {
  test("produces the expected InvoiceResult", async () => {
    const { result, error, outputDir } = await h.run("happy");
    try {
      expect(error).toBeUndefined();
      expect(result).toBeDefined();
      if (!result) return;

      expect(result.referencia).toMatch(/^\d+$/);
      expect(result.montoUSD).toBe(MONTO_USD);
      expect(result.montoUYU).toBe(EXPECTED_UYU);
      expect(result.baseCalculo).toBe(EXPECTED_BASE);
      expect(result.periodo).toBe(EXPECTED_PERIODO);
      expect(result.exchangeRate).toBe(40);
      expect(result.exchangeLeg).toBe("sell");
      expect(result.paymentLink).toContain(`ref=${result.referencia}`);
      expect(result.paymentLink).toStartWith("https://");
      expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      cleanup(outputDir);
    }
  }, 60_000);

  test("F2: the payment date is read back off the form, not fabricated", async () => {
    const { result, outputDir } = await h.run("happy");
    try {
      // The mock's field accepts DD/MM/YYYY, so the read-back should return exactly what
      // the run set — proving the value came from the FIELD and not from a local Date.
      expect(result?.fechaPago).toBe("12/08/2026");
    } finally {
      cleanup(outputDir);
    }
  }, 60_000);

  test("F14: downloads a real PDF (size + magic bytes)", async () => {
    const { result, outputDir } = await h.run("happy");
    try {
      expect(result?.pdfPath).toBeDefined();
      if (!result) return;
      expect(fs.existsSync(result.pdfPath)).toBe(true);
      expect(result.pdfPath).toEndWith(`FacturaBPS_${result.referencia}.pdf`);

      const file = Bun.file(result.pdfPath);
      expect(file.size).toBeGreaterThan(1_000);
      expect(await file.slice(0, 4).text()).toBe("%PDF");
    } finally {
      cleanup(outputDir);
    }
  }, 60_000);

  test("F17: writes a machine-readable result file", async () => {
    const { result, outputDir } = await h.run("happy");
    try {
      const resultFile = `${outputDir}/result_07-2026.json`;
      expect(fs.existsSync(resultFile)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(resultFile, "utf8"));
      expect(parsed).toEqual(result as unknown as Record<string, unknown>);
    } finally {
      cleanup(outputDir);
    }
  }, 60_000);

  test("F12: BPS received the date of birth in its hidden state field", async () => {
    const { submission, outputDir } = await h.run("happy");
    try {
      // The visible input is presentation only. What matters is what the postback carried.
      expect(submission["formulario:fechaNacimiento"]).toBe("17/07/1990");
      expect(submission["formulario:j_id23:documento"]).toBe("11111111");
    } finally {
      cleanup(outputDir);
    }
  }, 60_000);

  test("F21: the impuesto select is matched by label when values are numeric", async () => {
    const { submission, outputDir } = await h.run("happy");
    try {
      // The mock uses value="1" label="IRPF", so selectOption("IRPF") by VALUE fails and
      // the label fallback must carry it. Whether real BPS is keyed by value or label is
      // still open (plan §7 item 10) — this proves both paths work.
      expect(submission["formulario:impuesto"]).toBe("1");
    } finally {
      cleanup(outputDir);
    }
  }, 60_000);

  test("A4: BPS received exactly the amounts we intended", async () => {
    const { submission, outputDir } = await h.run("happy");
    try {
      expect(submission["formulario:montoFacturado"]).toBe(String(EXPECTED_UYU));
      expect(submission["formulario:baseCalculo"]).toBe(String(EXPECTED_BASE));
      expect(submission["formulario:periodo"]).toBe(EXPECTED_PERIODO);
    } finally {
      cleanup(outputDir);
    }
  }, 60_000);

  test("F18: --usd overrides the invoiced amount end to end", async () => {
    const { result, outputDir } = await h.run("happy", {
      envOverrides: { BPS_MONTO_USD: "1500" }
    });
    try {
      expect(result?.montoUSD).toBe(1500);
      expect(result?.montoUYU).toBe(60_000);
      expect(result?.baseCalculo).toBe(42_000);
    } finally {
      cleanup(outputDir);
    }
  }, 60_000);
});

describe("E2E-19 / F9: timing independence", () => {
  test("slow-postback passes unchanged", async () => {
    // Every render is delayed by 1.2s. With fixed waitForTimeout(300) sleeps this was a
    // coin flip; with anchored waits it is deterministic.
    const { result, error, outputDir } = await h.run("slow-postback");
    try {
      expect(error).toBeUndefined();
      expect(result?.montoUYU).toBe(EXPECTED_UYU);
    } finally {
      cleanup(outputDir);
    }
  }, 120_000);
});

describe("E2E-20 / A6: the double-run guard", () => {
  test("a second run for the same período is refused", async () => {
    const first = await h.run("happy");
    try {
      expect(first.error).toBeUndefined();

      // Re-run against the same output directory, so the previous result file is visible.
      const second = await h.run("happy", { outputDir: first.outputDir });
      expect(second.error).toBeDefined();
      expect(second.error?.message).toMatch(/already exists/);
      expect(second.error?.message).toMatch(/--force/);
      expect(second.error?.message).toContain(first.result?.referencia ?? "?");

      // …and --force lets it through.
      const forced = await h.run("happy", {
        outputDir: first.outputDir,
        force: true
      });
      expect(forced.error).toBeUndefined();
    } finally {
      cleanup(first.outputDir);
    }
  }, 90_000);
});
