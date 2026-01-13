# 🏥 FONASA Playwright

Automate BPS FONASA invoice generation using Playwright and Bun.

## ✨ Features

- 📝 Automatically fills the 4-step BPS FONASA form
- 💱 Fetches USD/UYU exchange rate from BCU (Central Bank of Uruguay)
- 🔄 Converts USD amounts to UYU using the last business day rate
- 📊 Calculates "Base de calculo" as 70% of invoiced amount
- 📄 Downloads the generated PDF invoice
- 🔗 Provides payment link for online payment

## 📋 Prerequisites

- [Bun](https://bun.sh/) runtime
- Chromium browser (installed via Playwright)

## 🚀 Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd fonasa-playwright

# Install dependencies
bun install

# Install Chromium browser
bun run install:browser
```

## ⚙️ Configuration

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. Edit `.env` with your data:

```env
# BPS Company Data
BPS_EMPRESA=1234567
BPS_RUT=123456789012

# Holder Data
BPS_DOCUMENTO=12345678
BPS_FECHA_NAC_DIA=17
BPS_FECHA_NAC_MES=Jul      # Ene, Feb, Mar, Abr, May, Jun, Jul, Ago, Sep, Oct, Nov, Dic
BPS_FECHA_NAC_ANIO=1990

# Invoice Settings
BPS_IMPUESTO=IRPF          # Options: IRPF, IRAE, IRPF e IRAE

# Amount in USD (will be converted to UYU)
BPS_MONTO_USD=10000

# Browser settings
HEADLESS=false             # Set to true for headless mode
```

## 🎮 Usage

```bash
# Run the script
bun start

# Or run with file watching (development)
bun dev
```

## 📤 Output

The script will:

1. Fetch the current exchange rate from BCU
2. Fill the BPS FONASA form automatically
3. Generate and download the invoice PDF to `./output/`
4. Display a summary with:
   - Reference number
   - Amount to pay
   - Due date
   - Payment link

Example output:

```
═══════════════════════════════════════════════════════════════
              📋 INVOICE GENERATED SUCCESSFULLY
═══════════════════════════════════════════════════════════════

  📌 Reference Number:    1538579955
  💵 Amount Invoiced:     $10,000 USD
  💱 Exchange Rate:       39.041 (2025-12-30)
  💰 Amount in UYU:       390,410 UYU
  📊 Base de calculo:     273,287 UYU (70%)
  🧾 Amount to Pay:       12,298 UYU
  📆 Payment Date:        12/01/2026
  📅 Due Date:            12/01/2026
  📁 PDF Location:        ./output/FacturaBPS_1538579955.pdf

  🔗 Payment Link:
     http://www.bps.gub.uy/8759/pago_de_facturas.html?ref=1538579955

═══════════════════════════════════════════════════════════════
```

## 📁 Project Structure

```
fonasa-playwright/
├── src/
│   └── index.ts       # Main script
├── output/            # Generated PDFs (gitignored)
├── .env               # Your configuration (gitignored)
├── .env.example       # Example configuration
├── package.json
└── README.md
```

## 📜 License

MIT
