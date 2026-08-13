/**
 * `bun run mock` — serve the fake BPS for manual poking.
 *
 *   bun run mock
 *   BPS_FORM_URL=http://localhost:3999/... HEADLESS=false bun start
 *
 * Append ?scenario=<name> to the URL to drive a specific failure injection.
 */
import { ALL_SCENARIOS, SCENARIOS } from "./scenarios";
import { startMockBps } from "./server";

const port = Number(process.env.MOCK_PORT ?? 3999);
const mock = startMockBps({ today: new Date(), port });

console.log(`\n🎭 Mock BPS listening on ${mock.url}\n`);
console.log("Run the bot against it with:\n");
console.log(`   BPS_FORM_URL='${mock.url}' bun start\n`);
console.log("Scenarios (append ?scenario=<name>):\n");
for (const name of ALL_SCENARIOS) {
  console.log(`   ${name.padEnd(28)} ${SCENARIOS[name]}`);
}
console.log("");
