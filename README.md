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

## 📜 License

MIT
