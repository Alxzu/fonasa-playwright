# 🏥 FONASA Playwright

Automate BPS FONASA invoice generation.

## 🚀 Quick Start

### 1️⃣ Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

### 2️⃣ Install dependencies

```bash
bun install
bun run install:browser
```

> Re-run `bun run install:browser` whenever Playwright is updated — each release pins a specific Chromium build, and a stale one fails at launch with `Executable doesn't exist`.

### 3️⃣ Configure

```bash
cp .env.example .env
```

Edit `.env` with your data:

```env
BPS_EMPRESA=1234567
BPS_RUT=123456789012
BPS_DOCUMENTO=12345678
BPS_FECHA_NAC=11/12/1990
BPS_MONTO_USD=1000
```

### 4️⃣ Run

```bash
bun start
```

## ⚙️ Configuration Options

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `BPS_EMPRESA` | Company number | `1234567` | ✅ |
| `BPS_RUT` | RUT number | `123456789012` | ✅ |
| `BPS_DOCUMENTO` | Document number | `12345678` | ✅ |
| `BPS_FECHA_NAC` | Birth date (DD/MM/YYYY) | `11/12/1990` | ✅ |
| `BPS_MONTO_USD` | Amount in USD | `1000` | ✅ |
| `BPS_IMPUESTO` | Tax type | `IRPF`, `IRAE`, or `IRPF e IRAE` | ❌ |
| `HEADLESS` | Hide browser | `true` or `false` | ❌ |
| `OUTPUT_DIR` | Where PDFs are saved | `./output` | ❌ |
| `EXCHANGE_RATE_API` | BCU rate endpoint | see `.env.example` | ❌ |

> `HEADLESS` defaults to `true`. Set it to exactly `false` to watch the browser — any other value keeps it hidden.

## 🛠️ Development

```bash
bun run lint        # check formatting + lint rules (Biome)
bun run lint:fix    # apply the safe fixes
bun run format      # format only
bun run typecheck   # tsc --noEmit
bun run dev         # run with --watch
```

`lint` and `typecheck` also run in CI on every push and pull request.

## 📤 Output

The script will:
- 💱 Fetch USD/UYU exchange rate from BCU
- 📝 Fill the BPS FONASA form
- 📄 Download the invoice PDF to `./output/`
- 🔗 Show payment link

```
═══════════════════════════════════════════════════════════════
              📋 INVOICE GENERATED SUCCESSFULLY
═══════════════════════════════════════════════════════════════

  📌 Reference Number:    1538579955
  💵 Amount Invoiced:     $1,000 USD
  💱 Exchange Rate:       39.041 (2025-12-30)
  💰 Amount in UYU:       39,041 UYU
  📊 Base de cálculo:     27,329 UYU (70%)
  📆 Payment Date:        12/01/2026
  📁 PDF Location:        ./output/FacturaBPS_1538579955.pdf

  🔗 Payment Link:
     http://www.bps.gub.uy/8759/pago_de_facturas.html?ref=1538579955

═══════════════════════════════════════════════════════════════
```

## 🩺 When a run fails

Two files are written to `OUTPUT_DIR`, sharing a timestamp so they pair up:

- `error_<timestamp>.png` — full-page screenshot at the point of failure
- `error_<timestamp>.txt` — the page URL, error message and stack trace

If the browser crashed or closed, the screenshot may be missing — the `.txt` is written first precisely so the diagnostics survive that case.

A scrubbed copy of the page HTML (`error_<timestamp>.html`, with every input value blanked)
and a Playwright trace (`trace_<timestamp>.zip`) are written alongside them. The trace is the
useful one — `bunx playwright show-trace trace_*.zip` gives a time-travelling DOM for every
action, which a screenshot cannot.

Each run also writes `output/result_<período>.json` with the full result, for scripting.

## 🎛️ CLI flags

```bash
bun start -- --usd 1500     # override the amount for this run
bun start -- --dry-run      # compute and print; never opens a browser
bun start -- --json         # print the result as JSON
bun start -- --force        # allow a second invoice for a período already invoiced
bun start -- --help
```

> ⚠️ A successful run creates a **real invoice** with tax implications. The bot refuses to
> invoice the same período twice unless you pass `--force`.

## 🧪 Testing

Four rungs, **none of which touch the real BPS**:

```bash
bun run typecheck        # tsc --noEmit
bun run lint             # biome
bun run test:unit        # date rules, rate walk-back, config, check digits — no browser
bun run test:selectors   # selector cascades vs hazard fixtures — no server
bun run test:e2e         # the whole pipeline vs a mock BPS, incl. 15 failure scenarios
bun run test             # all three, in order
```

> Use `bun run test`, not bare `bun test`. Each e2e file must run in its own process —
> more than one `chromium.launch()` per Bun process wedges (as few as two on a 2-core CI
> runner). `scripts/run-e2e.ts` enforces that; see `docs/IMPROVEMENT_PLAN.md` §12.

The mock is a stateful fake of the JSF wizard — it validates postbacks, re-renders with
error blocks on failure, and can inject specific faults. Drive the real bot against it:

```bash
bun run mock
BPS_FORM_URL='http://localhost:3999/SnisProfesionalesWeb/paginas/anticipos/snisAnticiposAInicio.jsf' bun start
```

Append `?scenario=<name>` to the URL to reproduce a specific failure — `bun run mock`
prints the list. See `docs/IMPROVEMENT_PLAN.md` for the design and what remains open.

## 📜 License

MIT
