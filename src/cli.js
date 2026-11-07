import "./env.js";
import { readFile } from "node:fs/promises";
import { createAgent } from "./agent.js";
import { liveTransport } from "./egress.js";
import { mockTransport } from "./mock.js";

const live = process.argv.includes("--live");
if (live && !process.env.CONTEXT_DEV_API_KEY) {
  console.error("CONTEXT_DEV_API_KEY is required for --live");
  process.exit(1);
}

const file = process.argv.find((a) => a.endsWith(".json")) ?? new URL("../data/customers.json", import.meta.url);
const records = JSON.parse(await readFile(file, "utf8"));
const agent = createAgent({
  transport: live ? liveTransport(process.env.CONTEXT_DEV_API_KEY) : mockTransport,
  zdr: process.env.CONTEXT_DEV_ZDR === "enabled",
});

const results = [];
for (const record of records) results.push(await agent.enrich(record));
console.log(JSON.stringify(results, null, 2));
