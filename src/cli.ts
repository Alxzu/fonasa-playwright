import { parseArgs } from "node:util";
import type { CliOverrides } from "./config";

export interface CliOptions extends CliOverrides {
  json: boolean;
  help: boolean;
}

export const USAGE = `
fonasa-playwright — generate the monthly BPS FONASA invoice

  bun start [options]

Options:
  --usd <amount>   Amount to invoice in USD (overrides BPS_MONTO_USD)
  --out <dir>      Output directory (overrides OUTPUT_DIR)
  --force          Generate even if this período was already invoiced
  --dry-run        Compute and print the amounts; never opens a browser
  --json           Print the result as JSON on stdout
  -h, --help       Show this help

⚠️  A successful run creates a REAL invoice with tax implications.
`;

/** Parse CLI overrides (plan F18) — the amount changes monthly; editing .env for it is friction. */
export function parseCliArgs(argv: string[]): CliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      usd: { type: "string" },
      out: { type: "string" },
      force: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false }
    },
    allowPositionals: false,
    strict: true
  });

  const options: CliOptions = {
    force: values.force,
    dryRun: values["dry-run"],
    json: values.json,
    help: values.help
  };

  if (values.usd !== undefined) {
    const usd = Number(values.usd);
    if (!Number.isFinite(usd) || usd <= 0) {
      throw new Error(`--usd must be a positive number, got "${values.usd}"`);
    }
    options.usd = usd;
  }
  if (values.out !== undefined) options.outputDir = values.out;

  return options;
}
