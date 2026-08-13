# fonasa-playwright — Improvement Plan & Working Guideline

**Status:** v2 — phases 0–5 and 7-partial **implemented**, rebased onto `main` after PRs #1–#3.
Baseline commit `cc85312`; toolchain now Playwright 1.62.1 + TypeScript 7. Phase 6 (the live-capture session) is the only remaining blocker,
and it needs the human. See §11 for what shipped and §12 for what building it taught us.
**Audience:** Claude Code sessions working on this repo (and the human reviewing them)
**Source material:** `~/Downloads/fonasa-playwright-review.md` (external review) + a verification pass over the code at `cc85312`

---

## 0. How to use this document

This is the **plan of record**. Work through phases in order. Each phase has a
**Definition of Done (DoD)** that is mechanically checkable — do not mark a phase
complete on vibes.

Conventions used below:

- **F<n>** — finding number from the external review (`fonasa-playwright-review.md`).
- **A<n>** — additional finding, not in the external review, added by the verification pass.
- **[verify live]** — cannot be settled without one real browser run against BPS. These are
  collected in §7 and must not block earlier phases; the code shape lands first, the constant lands after.
- **Spec IDs** (`DT-01`, `E2E-07`, …) — every test file references the spec ID it implements, so the
  spec catalog in §5 and the test suite stay in sync.

**Rule for the agent:** if a phase's DoD cannot be met, stop and report rather than
loosening the DoD. If a step turns out to be blocked, complete every other step in the
phase and say explicitly what was left out.

---

## 1. Context, and the danger model

This bot fills a 4-step JSF wizard on `app1.bps.gub.uy` and **generates a real, legally
meaningful invoice**. That single fact drives every decision in this plan:

1. **A successful run has side effects that cannot be undone from code.** Never run
   `bun start` against the real BPS host without the human explicitly asking, in that turn.
2. **The worst outcome is not a crash — it is a run that prints SUCCESS with a wrong
   number.** Crashes are visible and free. Silent wrong invoices are discovered by an
   accountant, months later. Every design tradeoff in this plan favours "fail loudly" over
   "carry on".
3. **BPS is a black box we cannot poke.** Runs are slow, stateful, and expensive. So the
   engineering goal is: *maximise what can be verified without touching BPS, and make every
   BPS touch leave a rich artifact behind.*

That third point is why §3 (the simulator) is the largest section of this document and
why it is scheduled before the risky rewrites, not after.

---

## 2. Verified baseline — what is actually wrong today

Confirmed by reading the code and running the compiler at `cc85312`. Nothing in this
table is speculative.

### P0 — can produce a wrong invoice or a false success

| ID | Location | Problem |
|----|----------|---------|
| F1 | `src/steps/step3.ts:42-76` | `fillAmount` / `fillBaseCalculo`: when no locator matches, the inner `else` does nothing — no throw, no warning. `confirmStep()` then clicks *Confirmar* on a form with an empty or default amount. |
| A1 | `src/steps/step3.ts:44,51,62,69` | The "primary → fallback" cascade **does not exist**. `locator('a, b, c').first()` resolves the CSS union and picks by **document order**, not selector-list order. Selector priority is an illusion throughout step 3. **Empirically confirmed — see §10.** |
| A2 | `src/steps/step3.ts:51,69` | `tr:has-text("Monto") input` matches *any ancestor* `<tr>` containing that text. JSF nests tables several deep, so this matches an outer wrapper row spanning the whole form, and `.first()` then resolves to the first input **on the page**. **Empirically confirmed — see §10: in a nested-table reproduction the fallback filled the `empresa` field.** Combined with A1 and the substring match `input[name*="j_id46"]` (which also matches `j_id460`, `j_id461`, …), the realistic failure is the invoice amount landing in an identity field while the run reports success. |
| F2 | `src/steps/step3.ts:78-99` | `fillPaymentDate` returns `formatDateES(today)` on **every** path, including the `catch`. The summary reports a payment date that was never necessarily entered. |
| F4 | `src/steps/step4.ts:21-25` | If `/ref=(\d+)/` does not match, `referencia` stays `""`, the PDF saves as `FacturaBPS_.pdf`, and the run prints SUCCESS with a blank reference and a broken payment link. |
| F6 | all steps | A JSF postback that fails validation **re-renders the same page**. `waitForLoadState("networkidle")` resolves happily, and step N+1 runs its selectors against step N's DOM. This is the mechanism behind every "weird cascade failure with a useless screenshot". |
| A3 | `src/steps/step2.ts` (whole file) | `fillStep2` is a blind click. It assumes "Anticipos mensuales" and the **period** defaults are correct and never reads back what BPS actually selected. The period decides *which month* is invoiced. This is the same silent-wrong-result class as F1–F4 and the external review does not mention it. |
| A4 | `src/steps/step4.ts` | Nothing ever verifies the amount **on the confirmation page**. A single read-back of monto + período + referencia after *Confirmar*, asserted against what we intended, catches every upstream failure mode at once — including ones nobody anticipated. Highest value-per-line change in this plan. |
| F5 | `src/config.ts:21` | Rate leg is `usd-cash` (billete) **sell**, the highest of the four legs. The conventional rate for converting foreign-currency income is typically interbank. Direction of harm: **over**-declaring → over-paying, i.e. a cashflow/money cost, not a compliance exposure. Domain question, not a code question — see §8. |

### P1 — broken now, or blocks tooling

| ID | Location | Problem |
|----|----------|---------|
| F7 | `tsconfig.json:4` + `src/steps/step1.ts:40,52,61`, `src/steps/step4.ts:24` | `bunx tsc --noEmit` produces exactly **4 errors**. Verified. Bun strips types at runtime so they never surface, but the repo does not pass its own compiler, which blocks a CI typecheck gate. |
| F8 | `src/steps/step4.ts:40` | `page.locator('a:has-text("Pagar Factura")').getAttribute("href")` — the only un-`.first()`'d locator in the codebase. `has-text` is substring-based; two matches → strict-mode throw. |
| A5 | `package.json` | `biome.json` is committed and configured, but `@biomejs/biome` is **not** in `devDependencies` and there is no `lint` script. Dead config. |
| A9 | `package.json:12` | `playwright: ^1.57.0` resolves to **1.62.1**, which requires browser build `chromium_headless_shell-1234`; the newest build present locally is `1223`. A fresh checkout therefore cannot launch a browser until `bun run install:browser` succeeds — and that script fails **silently with exit code 0** when egress is blocked, so the failure surfaces much later as a confusing `Executable doesn't exist`. Pin the Playwright version, and make browser presence an explicit preflight check with a clear message. |

### P2 — robustness

| ID | Location | Problem |
|----|----------|---------|
| F9 | 8 sites (`grep -rn waitForTimeout src/`) | `networkidle` + eight fixed `waitForTimeout(300–1000)` calls. Officially discouraged, and unreliable on JSF (keep-alive polling never idles; partial AJAX postbacks go idle *before* the DOM swap). The external review says "seven" — it is eight. |
| F10 | `src/utils/exchange-rate.ts:23` | No timeout on the rate fetch. A sleeping duckdns box blocks the run indefinitely. |
| F11 | `src/utils/date.ts:5` | `toISOString()` is UTC while `getLastDayOfPreviousMonth` builds a **local** date. From any UTC+ timezone the month-end date silently shifts a day, changing which rate is fetched. Accidentally safe from Montevideo only. |
| F12 | `src/steps/step1.ts:38-68` | DOB injection sets `.value` + dispatches events but never reads back. Worse than the review states: `querySelectorAll("input")` includes **hidden** inputs, and the loop `return`s on the first id/name match — if JSF's hidden companion state field appears first in DOM order, the code fills the hidden field, returns, and leaves the visible one empty. |
| F13 | `src/index.ts:12-24` | Failure capture is a screenshot only. A screenshot tells you what the page looked like, not what the selectors could have matched. Also `saveErrorScreenshot(page, error)` never uses `error`. |
| F14 | `src/steps/step4.ts:58` | `download.saveAs()` succeeds for a 0-byte file or an HTML error page. No size or magic-byte check. |
| A6 | `src/index.ts` | No double-run guard. Nothing prevents two executions producing two real invoices for the same period. |

### P3 — architecture / DX

F15 selectors scattered across four files (`j_id46`, `alt*="profImporte"`, `img[alt="calendario"]`, `"Siguiente >"`) · F16 no tests, no CI · F17 human-only output, no machine-readable result · F18 no CLI overrides for the monthly amount · F19 no CI/RUT check-digit validation · F20/H1 `CLAUDE.md` is the stock `bun init` template · F21 `impuesto` typed `string` with three legal values; `montoUYU` integer-rounded; `process.exit(0)` in `.then()` can truncate stdout · A7 `0.7` base-de-cálculo multiplier is a bare magic number at `src/index.ts:69` with no config, comment, or citation · A8 the default rate endpoint is a personal duckdns host with no fallback source.

### Corrections to the external review (do not propagate these)

- **F3 contradicts F12.** F3 recommends replacing the calendar widget with "the same
  `evaluate` + dispatched-events technique step1 already uses"; F12 then flags that exact
  technique as unproven and possibly leaving JSF's hidden state field null. Do not adopt
  the step1 technique as a *fix* until F12 is settled — §3.4 makes it testable.
- **F13's privacy rationale is mechanically wrong.** `fill()` sets the value *property*,
  not the attribute, so `page.content()` on a freshly-typed page often does **not** contain
  what was typed. The scrubbing requirement still stands, for a different reason: JSF
  re-renders server-side on every postback with `value="…"` populated, so error HTML
  captured at step 3 or 4 genuinely does carry documento/RUT.
- **H4's settings snippet** is fenced as `jsonc` with `//` comments; `.claude/settings.json`
  is parsed as strict JSON — strip them. And `Bash(bun test*)` is not the documented
  pattern form; verify against current Claude Code docs before pasting.
- **F16's test plan is not implementable as written** — see §4.1.

---

## 3. The simulator: how to test a form filler without the form

This is the core of the plan. Everything else is ordinary engineering.

### 3.1 The problem

We need to prove that selectors and step logic are correct, but:

- the real page cannot be reached from a test run,
- each real run creates a real invoice,
- and we have **no captured fixtures yet** — so any HTML we write today is a guess.

The trap to avoid: hand-authoring a fixture that matches our selectors, then writing a
test that asserts our selectors match the fixture. That proves nothing. It is a mirror,
not a test.

### 3.2 The solution: adversarial fixtures + a stateful mock, in two tiers

**Tier A — synthetic hazard fixtures (available now, no live run).**
Hand-authored HTML built from JSF/MyFaces/RichFaces rendering conventions, deliberately
written to be **hostile**: nested wrapper tables, auto-generated `j_id*` ids that collide
on substring match, a hidden companion date input placed *before* the visible one,
adjacent-month day cells in the calendar grid, the phrase "Pagar Factura" appearing twice.

Tier A cannot prove our selectors match BPS. It **can** prove they are not naive — that
they survive the specific failure modes we know JSF produces. That is a real and
sufficient guarantee for phases 3–5, and it is honest about what it does not cover.

> Every Tier A constant that is a guess about BPS gets a `// @bps-unverified` comment.
> §7 is the checklist that retires them.

**Tier B — captured fixtures (after one live run).**
`page.content()` from each step of a real run, scrubbed, committed to `fixtures/`. Ground
truth. Once these exist they become the mock's base templates and Tier A degrades to a
hazard *overlay* applied on top of real markup.

**The mock server** sits above both tiers: a `Bun.serve()` implementation of the wizard as
a **state machine with real postback semantics**, not a static file server. It validates
submissions, re-renders the same page with an error block on failure (which is exactly the
F6 mechanism), issues a reference number, and serves a downloadable PDF.

With `BPS_FORM_URL` promoted to config, the entire pipeline runs end-to-end against it:

```
BPS_FORM_URL=http://localhost:3999 bun start
```

### 3.3 Layout

```
test/
  unit/                     # no browser, no server
    date.test.ts
    exchange-rate.test.ts
    config.test.ts
    check-digits.test.ts
  selectors/                # browser via page.setContent(), no server
    step1.selectors.test.ts
    step3.selectors.test.ts
    step4.selectors.test.ts
  e2e/                      # browser + mock server
    happy-path.test.ts
    failure-modes.test.ts
  mock-bps/
    server.ts               # Bun.serve wizard state machine
    render.ts               # per-step HTML generators (Tier A) / fixture loaders (Tier B)
    scenarios.ts            # named failure injections
    pdf.ts                  # synthetic PDF bytes
fixtures/                   # Tier B, populated after the live capture session
scripts/
  scrub-fixture.ts          # HTMLRewriter-based PII scrubber
```

**Use Bun's built-in `HTMLRewriter`** for both fixture scrubbing and Tier-A-overlay-on-Tier-B
mutation. It is streaming, native, and needs no DOM-parser dependency.

**Generate the PDF bytes in code** (`mock-bps/pdf.ts`), do not commit a fixture file:
`.gitignore` already contains `*.pdf`, so a committed fixture PDF would be silently
dropped from the repo. The generator must produce a file **larger than the size threshold**
asserted by F14 (>1000 bytes) — pad the content stream.

### 3.4 The payoff: every silent-failure finding becomes an executable test

The mock's job is not the happy path. It is to make each P0 **reproducible on demand**.
Scenarios are selected per-request (`?scenario=…` or a header) so a single test file can
walk all of them.

| Scenario | Reproduces | The test asserts |
|----------|-----------|------------------|
| `happy` | — | full pipeline, correct reference / amount / PDF |
| `amount-field-renamed` | F1 | run **throws**; *Confirmar* is never clicked |
| `amount-reformatted` | F1 read-back | JSF converter rewrites the value after `fill()` → read-back mismatch throws |
| `amount-decoy-outer-row` | A1, A2 | a wrapper `<tr>` containing "Monto" exists; the amount still lands in the real field, or throws |
| `jsf-id-collision` | A2 | `j_id460` exists alongside `j_id46`; the correct field is chosen |
| `calendar-missing` | F2 | `fechaPago` comes back `null`; the summary never fabricates a date |
| `calendar-adjacent-month` | F3 | grid renders a duplicate day cell from the next month; correct cell chosen or clean throw |
| `hidden-date-companion-first` | F12 | hidden state input precedes the visible one; the visible field still gets filled |
| `hidden-date-not-submitted` | F12 | server rejects when only the visible field is set → error gate names step 1 |
| `validation-error-step1` | F6 | re-rendered step 1 + message block → named exception, not a step-2 cascade |
| `validation-error-step3` | F6 | same, at step 3 |
| `period-unexpected-default` | A3 | step 2 pre-selects a different período → run refuses to continue |
| `confirm-amount-mismatch` | A4 | results page shows a different monto → run throws after confirmation |
| `link-no-ref` | F4 | payment link without `ref=` → throws, no `FacturaBPS_.pdf` written |
| `duplicate-pagar-link` | F8 | phrase appears twice → no strict-mode crash, correct href |
| `pdf-zero-bytes` | F14 | 0-byte download → throws |
| `pdf-is-html-error` | F14 | download is an HTML error page → magic-byte check throws |
| `slow-postback` | F9 | 3s delayed render → anchored waits pass without any `waitForTimeout` |

**This table is the acceptance criteria for phase 5.** A step rewrite is done when its
scenarios go green, not when it "looks right".

### 3.5 Mock fidelity rules

The mock must model these JSF behaviours, because they are the ones that bite:

1. **Command links, not submit buttons.** JSF renders `<h:commandLink>` as
   `<a href="#" onclick="…form.submit()">`. Include the JS shim so Playwright's click
   actually navigates — a mock built from `<button type=submit>` would not exercise the
   real path.
2. **Failed validation re-renders the same URL and the same step** with a message container
   populated. Never redirect on error.
3. **Server-side state lives in a hidden field**, and the server validates against the
   hidden field, not the visible input. This is what makes F12 testable rather than
   permanently `[verify live]`.
4. **Values echo back into `value="…"` attributes** on every re-render, so the scrubber has
   something real to scrub and the F13 privacy concern is exercised.
5. **Auto-generated ids** (`j_id46`, `j_id460`) that are stable within a run but arbitrary.

### 3.6 Honest limits — write these in the mock's header comment

- The mock proves **our logic**, never **our selectors' correspondence to BPS**.
- A green suite after a BPS redeploy means nothing until fixtures are refreshed.
- Tier A markup is an educated guess and is labelled as such; §7 retires each guess.

---

## 4. Prerequisite refactors (nothing is testable without these)

### 4.1 Inject the clock

`getLastDayOfPreviousMonth()` takes **no arguments** — it calls `new Date()` internally
(`src/utils/date.ts:40`). The external review's F16 test plan ("across month lengths,
weekend-ending months, and year boundaries") is therefore **not implementable as written**.

```ts
export function getLastDayOfPreviousMonth(today: Date = new Date()): Date
export function getPreviousBusinessDay(date: Date): Date   // already pure
```

Note also the name lies: it returns the last *business* day. Rename to
`getLastBusinessDayOfPreviousMonth`, or split the weekend walk-back out so the two rules
are independently testable. Prefer the split — the weekend rule and the month-end rule are
different business rules and currently only testable as a pair.

`bun:test`'s `setSystemTime` is available as a fallback, but explicit injection is better:
it also documents that the function is time-dependent.

### 4.2 Inject the rate dependencies

`getExchangeRate()` reads module-scoped `config` and global `fetch`.

```ts
export interface RateDeps { api: string; today: Date; fetch: typeof globalThis.fetch }
export async function getExchangeRate(deps?: Partial<RateDeps>): Promise<ExchangeRate>
```

### 4.3 Split `main()`

```ts
export async function runInvoice(cfg: Config, page: Page): Promise<InvoiceResult>
```

with the CLI wrapper separate. Required for the e2e tier (which needs to drive the pipeline
in-process, not scrape a subprocess's stdout) and for any future caller.

### 4.4 Promote `BPS_FORM_URL` to config

Currently hardcoded at `src/steps/step1.ts:4`. Without this, e2e against the mock is
impossible. Default stays the real BPS URL.

### 4.5 `src/selectors.ts` as the single mutation surface

One typed module, cascades as **arrays** (which is what makes A1 go away — an ordered
array iterated one-at-a-time is a real priority list; a CSS union is not):

```ts
export const selectors = {
  step3: {
    monto: ['input[id$="monto"]', 'input[name*="j_id46"]', /* @bps-unverified */],
    // …
  },
} as const;
```

When BPS redeploys, an agent should touch **one file**, and the fixture tests define "done".

---

## 5. Spec catalog

Every test names its spec ID. Specs are behavioural (given/when/then), not
implementation-shaped.

### DT — `src/utils/date.ts`

| ID | Spec |
|----|------|
| DT-01 | `formatDateISO` formats from **local** parts; a date built as local midnight in a UTC+ timezone yields that same calendar day (F11) |
| DT-02 | `formatDateES` pads day and month to 2 digits |
| DT-03 | month-end resolves correctly for 31/30/28-day months |
| DT-04 | February 2028 (leap) → 29 |
| DT-05 | January → 31 December of the **previous year** |
| DT-06 | month-end falling on Saturday → Friday; on Sunday → Friday; on a weekday → unchanged |
| DT-07 | `getPreviousBusinessDay` from Monday → Friday; Sunday → Friday; Saturday → Friday; Tuesday → Monday |
| DT-08 | `getPreviousBusinessDay` is pure — does not mutate its argument |

### EX — `src/utils/exchange-rate.ts`

| ID | Spec |
|----|------|
| EX-01 | happy path returns `{rate, date}` from `rates.sell` for the month-end date |
| EX-02 | two consecutive 404s then success — asserts the **exact sequence of dates requested** (the business-day walk-back) |
| EX-03 | JSON body `{error: "No exchange rate available"}` with a non-404 status is treated as a retry, not a fatal |
| EX-04 | a network throw fails **fast** — no retry loop, error names the endpoint |
| EX-05 | HTTP 500 throws immediately with the status in the message |
| EX-06 | 10 consecutive 404s exhausts retries and throws |
| EX-07 | request carries an `AbortSignal.timeout`; a hung server rejects within the budget (F10) |
| EX-08 | the rate leg used is asserted explicitly, so changing it (F5) is a deliberate, test-visible act |

### CF — `src/config.ts`

| ID | Spec |
|----|------|
| CF-01 | each missing required var is named in the error |
| CF-02 | malformed `BPS_FECHA_NAC` rejected; valid DD/MM/YYYY accepted |
| CF-03 | `31/02/1990` — structurally valid, calendrically impossible — is **rejected** (currently passes the regex) |
| CF-04 | `montoUSD` ≤ 0, `NaN`, or non-numeric rejected |
| CF-05 | `impuesto` outside the three legal values rejected at config time, not at step 3 (F21) |
| CF-06 | `headless` defaults to `true`; only the literal string `"false"` disables it |

### CD — check digits (F19)

| ID | Spec |
|----|------|
| CD-01 | known-valid cédulas pass |
| CD-02 | a cédula with one transposed digit fails |
| CD-03 | known-valid RUTs pass |
| CD-04 | **ships as a warning, not a hard failure, until CD-01/CD-03 are confirmed against at least three real known-valid values.** A wrong check-digit implementation that blocks a valid run is worse than no validation. |

### SL — selector cascades (Tier A now, Tier B after capture)

| ID | Spec |
|----|------|
| SL-01 | every cascade resolves to **exactly one** element on the fixture — count is 1, not ≥1 |
| SL-02 | the amount cascade does not resolve to the empresa/rut/documento inputs on a decoy-wrapper-row fixture (A2) |
| SL-03 | cascade order is honoured: with two candidates present, the **earlier array entry** wins regardless of DOM order (A1) |
| SL-04 | the DOB cascade selects the **visible** input when a hidden companion precedes it (F12) |
| SL-05 | the "Pagar Factura" cascade returns one href when the phrase appears twice (F8) |
| SL-06 | a cascade that matches nothing produces a diagnostic naming the label and every attempted selector — never a silent skip |

### S1–S4 — step behaviour (against the mock)

| ID | Spec |
|----|------|
| S1-01 | after step 1, arrival at step 2 is asserted by an anchor unique to step 2 (F9) |
| S1-02 | a rejected step-1 postback throws naming step 1 and quoting the server message (F6) |
| S1-03 | DOB is read back after injection and mismatches throw (F12) |
| S1-04 | the positional `inputs[3]` fallback logs loudly when used, or is removed |
| S2-01 | the selected período is **read back and asserted** against the expected period; an unexpected default aborts (A3) |
| S2-02 | invoice type is read back and asserted, not assumed |
| S3-01 | an unfillable amount throws before *Confirmar* is clicked (F1) |
| S3-02 | the amount is read back via `inputValue()` and a converter-mangled value throws (F1) |
| S3-03 | `fechaPago` is read **from the field**, and is `null` — never today's date — when unset (F2) |
| S3-04 | base de cálculo is derived from the *entered* monto, and the 70 % factor is a named, configurable constant (A7) |
| S4-01 | a payment link without `ref=` throws; no `FacturaBPS_.pdf` is written (F4) |
| S4-02 | the payment link is resolved to an absolute URL |
| S4-03 | downloaded file is >1000 bytes **and** starts with `%PDF` (F14) |
| S4-04 | monto, período and referencia are read off the results page and asserted against intent (A4) |

### E2E — full pipeline against the mock

| ID | Spec |
|----|------|
| E2E-01 | `happy` scenario produces the expected `InvoiceResult`, a valid PDF, and a machine-readable `result_<ref>.json` (F17) |
| E2E-02..17 | one per row of the §3.4 scenario table — each asserts a **named exception**, not a generic failure |
| E2E-18 | the whole suite contains **zero** `waitForTimeout` calls in `src/` (grep assertion) (F9) |
| E2E-19 | `slow-postback` passes unchanged, proving timing-independence |
| E2E-20 | a second run for the same period is refused without `--force` (A6) |
| E2E-21 | on failure, error HTML + trace + screenshot are written, and the HTML contains **no** documento/RUT/DOB values (F13) |

---

## 6. Phased plan

### Phase 0 — tooling floor
*Closes: F7, A5, A9*

1. `tsconfig.json`: `"lib": ["ESNext", "DOM"]`. (Note the tradeoff: this makes `document`
   and `window` visible to *all* files including server code. Acceptable and standard for
   Playwright repos; the alternative is a `/// <reference lib="dom" />` in `step1.ts` only.)
2. Add `@biomejs/biome` to `devDependencies` — the config is committed but the tool is not
   installed.
3. `package.json` scripts: `typecheck`, `test`, `test:unit`, `test:selectors`, `test:e2e`,
   `lint`, `mock`.
4. `.github/workflows/ci.yml`: `bun install && bun run typecheck && bun run lint && bun test`.
   - A9 — pin the Playwright version exactly (drop the `^`) and add a browser preflight
     that fails with an actionable message instead of Playwright's late
     `Executable doesn't exist`.

**DoD:** `bun run typecheck` exits 0 with zero errors. CI green on a trivial PR. A fresh
checkout either has a working browser or says precisely why not.

### Phase 1 — static P0/P1 fixes that need no page
*Closes: F4, F8, F10, F11, F21, A6*

5. F4 — throw on missing `ref` (also removes one of the four tsc errors).
6. F8 — `.first()`, and prefer `getByRole("link", { name: /pagar factura/i })`.
7. F10 — `AbortSignal.timeout(10_000)` on the rate fetch.
8. F11 — `formatDateISO` from local parts.
9. F21 — `impuesto` union type + `validateConfig` check; drop `process.exit(0)` from `.then()`.
10. A6 — double-run guard: refuse to start if a result for the current period already
    exists, unless `--force`. (Depends on F17's `result_*.json`; if that is not yet in
    place, land a minimal marker file now.)
11. A7 — hoist `0.7` to a named constant with a comment citing its basis.

**DoD:** typecheck + lint clean. Each item has a spec ID from §5 and a test (unit-testable
ones now, the rest deferred to phase 4 with the ID reserved).

### Phase 2 — testability refactors
*Enables everything after. Closes: F15*

12. §4.1 clock injection + the rename/split.
13. §4.2 rate dependency injection.
14. §4.3 `runInvoice(cfg, page)` split.
15. §4.4 `BPS_FORM_URL` into config.
16. §4.5 `src/selectors.ts` with array cascades + a `fillRequired`-style ordered resolver.
    This is where A1 dies.

**DoD:** no behaviour change intended; typecheck + lint clean; `bun start` against real BPS
still *not* run. Diff reviewable as pure refactor.

### Phase 3 — unit suite
*Closes: F16 (pure half), F19, CF-03*

17. Implement DT-01..08, EX-01..08, CF-01..06, CD-01..04.

**DoD:** `bun test test/unit` green; every spec ID in those tables has a test that names it;
CI runs it.

### Phase 4 — the simulator
*The centrepiece. Closes: SL-*, and unblocks phase 5.*

18. `scripts/scrub-fixture.ts` (HTMLRewriter) — needed before any capture, so it exists
    before the live run rather than being improvised during it.
19. `test/mock-bps/` — Tier A renderers, the state machine, the scenario switch, the PDF
    generator (§3.3, §3.5).
20. `test/selectors/` — SL-01..06 against Tier A fixtures.
21. `bun run mock` script for manual poking with `HEADLESS=false`.

**DoD:** `bun run mock` serves a clickable 4-step wizard; `BPS_FORM_URL=http://localhost:3999
bun start` completes end-to-end against it; every scenario in §3.4 is reachable; SL tests green.

### Phase 5 — rewrite the steps against the mock
*Closes: F1, F2, F6, F9, F12, F13, F14, A2, A3, A4*

22. `fillRequired` with read-back (F1) — now provable via `amount-reformatted`.
23. `expectNoJsfErrors` gate after every navigation (F6) — selector list is a **parameter**,
    the real value lands in phase 6.
24. Arrival anchors per step, delete all eight `waitForTimeout` (F9).
25. `fechaPago` read from the field, `null` when unset (F2) — and propagate `null` through
    `InvoiceResult` (type change) rather than fabricating.
26. Calendar: resolve the F3/F12 contradiction using `hidden-date-*` scenarios instead of
    guessing.
27. A3 — read back and assert the período in step 2.
28. A4 — terminal read-back of monto/período/referencia on the results page.
29. F14 — PDF size + magic bytes.
30. F13 — trace + scrubbed error HTML in the failure path; drop or use the unused `error` param.

**DoD:** every row of §3.4 has a green test asserting a **named** exception. E2E-18's grep
assertion passes.

### Phase 6 — the live capture session *(human present, one run)*
*Closes: the `[verify live]` list in §7*

This is the only phase that touches BPS. Run once, `HEADLESS=false`, tracing on, and
capture everything in §7 in that single session. Then:

31. Scrub and commit Tier B fixtures.
32. Re-point selector tests at Tier B; keep Tier A as a hazard overlay.
33. Reconcile: every `@bps-unverified` marker either confirmed or corrected.
34. One confirming live run.

### Phase 7 — harness and DX
*Closes: F17, F18, F20/H1, H2–H5*

35. F17 machine-readable `result_*.json`.
36. F18 CLI overrides (`--usd`, `--force`, `--dry-run`).
37. F20/H1 rewrite `CLAUDE.md` as project knowledge — wizard map, JSF landmines, debug loop,
    domain rules, conventions, and the danger rule as the first line.
38. H3 skills (`bps-repair`, `bps-add-field`, `bps-monthly`) — thin, carrying only
    BPS-specific knowledge and guardrails.
39. H4 `.claude/settings.json` permissions — strict JSON, verified pattern syntax.
40. A8 rate-source fallback, or at minimum a documented manual override path.

### Explicit non-goals (from H6, endorsed)

No MCP server for BPS. No scheduled autonomous runs. No LLM-in-the-loop self-healing
selectors at runtime. The payoff here is **autonomous maintenance**, not autonomous
operation — the human stays on the trigger.

---

## 7. Live-capture checklist — the one session that retires the `[verify live]` list

Print this. Run once, `HEADLESS=false`, `tracing.start({screenshots:true, snapshots:true})`.
Capture `page.content()` at every step before clicking anything.

| # | Question | Retires |
|---|----------|---------|
| 1 | Exact arrival anchor text/selector unique to each of steps 2, 3, 4 | F9, S1-01 |
| 2 | The JSF message container class on a **deliberately invalid** submission (submit step 1 with a bad documento) | F6 |
| 3 | Real `id`/`name` of the monto and base-de-cálculo inputs; do they contain `j_id46`? | F1, A1, A2 |
| 4 | Does the monto field reformat the value after `fill()` (thousands separator, comma decimal)? | F1, F21 |
| 5 | Which calendar component is it? (`img[alt="calendario"]` suggests Tomahawk/custom, not RichFaces) — capture the widget's DOM open | F3 |
| 6 | Does the calendar render adjacent-month day cells? Are day cells `<a>` or `<td onclick>`? | F3 |
| 7 | Is there a hidden companion date input for DOB? What is its name, and does it precede the visible input? | F12, SL-04 |
| 8 | Does step 1 pass validation when only the visible DOB field is set? | F12 |
| 9 | Step 2's default período and invoice type as rendered — exact text and control type | A3 |
| 10 | The `<select>` for impuesto: option **values** vs labels | F21 |
| 11 | The results page: where are monto, período and referencia displayed? | A4 |
| 12 | Is the "Pagar Factura" href absolute or relative? Does the phrase appear more than once? | F4, F8 |
| 13 | Confirm the four rate legs your proxy exposes and which slug is interbank | F5 |

Capture cost is one session. Do not spread these across multiple live runs — each one is a
real invoice.

---

## 8. Open questions for the human

1. **F5 — which rate leg?** Currently `usd-cash` **sell** (billete venta), the highest of
   the four. If the applicable convention is interbank, the current bot systematically
   over-declares. Direction of harm is over-payment, not under-payment — a money/cashflow
   cost rather than a compliance exposure, which is why this is a "confirm before the next
   run" and not a "stop everything". Needs an accountant/DGI answer, not a code change.
2. **A7 — what is the basis of the 70 % base de cálculo?** Statutory? Regime-specific?
   It should be a documented constant with a citation, and possibly config.
3. **A3 — what período *should* be invoiced**, expressed as a rule the code can assert
   (e.g. "the month just ended")? Without a rule there is nothing to assert against.
4. **CD — three known-valid cédula/RUT values** to validate the check-digit implementation
   before it is allowed to block a run.
5. **A8 — is a fallback rate source wanted**, or is a clear failure on the 30th acceptable?

---

## 9. Verification ladder

Four rungs, only the last touches BPS:

```
bun run typecheck        # tsc --noEmit, zero errors
bun run lint             # biome
bun test test/unit       # pure logic — date rules, rate walk-back, config, check digits
bun test test/selectors  # cascades vs fixtures — no server
bun test test/e2e        # full pipeline vs mock BPS, all failure scenarios
bun start                # REAL INVOICE — human-requested only, never by an agent
```

Rungs 1–5 are what an agent may run freely. Rung 6 is the human's.

**Preflight (A9):** rungs 4–5 need a Playwright browser build matching the *resolved*
Playwright version. `bun run install:browser` exits 0 even when it downloads nothing, so
add an explicit check before the browser-based suites rather than letting it fail later as
`Executable doesn't exist`.

---

## 10. Appendix — empirical proof of A1 and A2

Run against Playwright 1.62.1 during the verification pass. These are not arguments from
documentation; this is the observed behaviour.

```ts
// A1 — "monto" input is FIRST in the DOM; "j_id46" input is SECOND.
// The code's intent (selector listed first) is that j_id46 wins.
await p.setContent(`<input id="monto_decoy" value="DECOY"><input name="j_id46_real" value="REAL">`);
await p.locator('input[name*="j_id46"], input[id*="monto"]').first().inputValue();
// => "DECOY"      ← document order won; the selector list order was ignored

// the same candidates as an ordered array, iterated one at a time:
// => "REAL"       ← this is what §4.5 changes it to

// A2 — nested JSF-style tables, outer wrapper row also contains the label text
await p.setContent(`<table><tr><td>Monto facturado wrapper
  <table><tr><td><input id="empresa" value="EMPRESA-FIELD"></td></tr>
  <tr><td>Monto facturado <input id="real_monto" value="MONTO-FIELD"></td></tr></table>
</td></tr></table>`);
await p.locator('tr:has-text("Monto facturado") input').first().inputValue();
// => "EMPRESA-FIELD"   ← matched 2 inputs; .first() picked the identity field
```

**Read A2 carefully.** The current fallback path in `fillAmount`, on a page shaped the way
JSF actually shapes pages, writes the invoice amount into the first input on the form. The
external review classified this as "does nothing when no selector matches". It is
considerably worse than that, and it is the strongest single argument for scheduling the
simulator (phase 4) *before* the step rewrites (phase 5) rather than after.

`HTMLRewriter` confirmed available in Bun 1.3.9 — the §3.3 scrubber/overlay approach is viable.

---

## 11. Implementation status (v2)

Verification ladder at the time of writing — all green, none of it touching BPS:

```
bun run typecheck   → 0 errors (was 4)
bun run lint        → clean, 31 files
bun run preflight   → playwright ^1.62.1, chromium 144.x
bun test            → 102 pass, 0 fail, 14s
```

| Phase | State | Notes |
|-------|-------|-------|
| 0 — tooling floor | ✅ | `lib: ESNext, DOM, DOM.Iterable`; biome + `lint`; `typecheck`/`test:*`/`mock`/`preflight` scripts; CI workflow |
| 1 — static P0/P1 | ✅ | F4, F8, F10, F11, F21, A6, A7 |
| 2 — testability refactors | ✅ | clock injection, rate deps, `runInvoice()`, `BPS_FORM_URL`, `src/selectors.ts` |
| 3 — unit suite | ✅ | 63 tests: DT-01..08, EX-01..08, CF-01..06, CD-01..04 |
| 4 — the simulator | ✅ | `test/mock-bps/` + 12 selector tests against Tier A hazard fixtures |
| 5 — step rewrites | ✅ | 27 e2e tests; every §3.4 scenario asserts a **named** exception |
| 6 — live capture | ⛔ | **Blocked on the human.** §7 is the checklist; 22/22 cascades still `@bps-unverified` |
| 7 — harness | ◐ | F17 + F18 done. CLAUDE.md rewrite, skills, permissions still open |

Verified by hand, driving the real CLI against the mock: happy path, the double-run
refusal, `--dry-run`, and a failure run writing screenshot + scrubbed HTML + note + trace
(PII check on the error HTML came back clean).

### ⚠️ The first live run will probably fail at step 2 — by design

`fillStep2` now refuses to continue if it cannot read the período, and `step4` refuses if it
cannot read the confirmed amount. Both selectors are `@bps-unverified` guesses. That is the
correct trade — the alternative is silently invoicing an unverified month — but it means
the first real run is likely to stop with a message pointing at §7 rather than produce an
invoice. Pin those two selectors during the capture session and it clears.

## 12. What building it changed (v2 findings)

Findings that only appeared once the code was written and run. These are the argument for
scheduling the simulator before the rewrites rather than after.

- **A10 — blur-time converters escape an immediate read-back.** `fillRequired` verifies
  right after `fill()`, which catches converters firing on `input`/`change`. JSF converters
  commonly fire on **blur** — so the monto could still be rewritten later, when the next
  field took focus, and the read-back would have already passed. Caught by the
  `amount-reformatted` scenario, which mangles the value on blur. Fixed by re-verifying
  both money fields immediately before clicking *Confirmar* (`assertStillSet`).
  This is a real defect the plan did not anticipate.
- **A11 — repeated `chromium.launch()` in one Bun process wedges.** The process silently
  stops making progress; whichever test is running times out, and the *failing test moves
  between runs*, which reads as flakiness in the code under test. **The threshold is
  machine-dependent** — about 4 launches on an 8-core laptop, but as few as **2** on a
  2-core GitHub runner, so the suite passed locally and then hung in CI from the second
  file onward. Two halves to the invariant, and you need both:
  1. one launch per FILE — one browser per harness, fresh browser *context* per run
     (`test/e2e/harness.ts`). Module-level singletons shared across files do not work:
     one file's `afterAll` tears down a browser another file is still using.
  2. one file per PROCESS — `scripts/run-e2e.ts` spawns a separate `bun test` per e2e
     file, globbed so adding a file cannot silently reintroduce the problem.

  Net effect: e2e went from 131s with 2 spurious failures to ~14s with none. Worth knowing
  before anyone "fixes" a phantom flake. **Do not run bare `bun test`** — use `bun run test`,
  which walks the ladder tier by tier.
- **A2 refinement — `[name*="j_id46"]` also matches `j_id460`.** Building the
  `jsf-id-collision` fixture showed the substring match is ambiguous even *inside* an
  ordered cascade. Changed to a suffix match.
- **Payment-link disambiguation is subtler than `.first()`.** A bare `a[href*="ref="]` also
  matches the PDF download link; a bare text match also matches a header nav link. The
  cascade now requires both signals first, then degrades.
- **`lib: ["ESNext", "DOM"]` is not sufficient** — iterating a `NodeListOf` needs
  `DOM.Iterable` too. The plan's F7 fix would have left one error standing.

### Corrections to §2

- **A5 was wrong.** `biome.json` is *not* committed at `cc85312`. It landed on `main`
  separately as PR #1 while this branch was being built, along with the `lint`/`typecheck`
  scripts. This branch is rebased onto that and uses **their** config and their formatting
  style (`trailingCommas: "none"`), not its own.
  - Note for anyone running lint from a worktree under `.claude/`: their `files.includes`
    excludes `!**/.claude`, which matches the worktree's own root path, so `biome check .`
    silently processes **zero** files there. Harmless on a normal checkout; pass explicit
    paths (`biome check src test scripts`) when verifying from a worktree.
- **A9 was overstated, and is now moot.** At `cc85312` the lockfile pinned playwright
  1.57.0, so `bun install` yielded a working browser; the drift was only in the main
  checkout's `node_modules`. `main` has since moved to `^1.62.1` and TypeScript 7 (PR #2),
  and this branch adopts that — the whole suite passes on it.
  The underlying hazard is still real: `playwright install` *prunes* browser builds for
  other versions, which is exactly how the 1.57 build vanished mid-session here. The
  recommendation to pin exactly was **not** applied, because that is the repo owner's call
  and `main` deliberately chose a range. `scripts/preflight.ts` stays, and warns when the
  version is range-pinned rather than failing.

## 13. Next actions

1. **Human:** run the §7 live-capture session once, `HEADLESS=false`, tracing on.
2. Pin the período and confirmed-amount selectors first — they gate every run.
3. Answer §8 — above all F5 (which rate leg) and A7 (the basis of the 70 % factor).
4. Then the remaining phase-7 harness work: CLAUDE.md rewrite, skills, permissions.
