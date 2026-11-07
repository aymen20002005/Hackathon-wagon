import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const ENTRY = fileURLToPath(new URL("../vendor/scortonjs/index.js", import.meta.url));
const VENV_BIN = fileURLToPath(new URL("../.venv/bin", import.meta.url));

function extractJson(stdout) {
  const lines = stdout.split("\n");
  const start = lines.findIndex((l) => /^[{[]/.test(l));
  if (start < 0) return null;
  try {
    return JSON.parse(lines.slice(start).join("\n"));
  } catch {
    return null;
  }
}

const pickScore = (j) => {
  const v = j?.score ?? j?.cyberscore ?? j?.cyber_score ?? j?.data?.score ?? j?.result?.score;
  return Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null;
};

// ScortonJS spawns `python3 scorton.py` and talks to a Scorton API; token comes from SCORTON_TOKEN.
export function createScorton({ minScore = Number(process.env.SCORTON_MIN_SCORE ?? 50) } = {}) {
  const installed = existsSync(ENTRY);
  const hasToken = Boolean(process.env.SCORTON_TOKEN);
  const enabled = installed && hasToken;
  const reason = !installed
    ? "ScortonJS not installed (npm run setup:scorton)"
    : !hasToken
      ? "SCORTON_TOKEN not set"
      : null;

  let client = null;
  if (enabled) {
    if (existsSync(VENV_BIN)) process.env.PATH = `${VENV_BIN}${path.delimiter}${process.env.PATH}`;
    const Scorton = require(ENTRY);
    client = new Scorton();
  }

  return {
    enabled,
    reason,
    minScore,
    async assess(domain) {
      if (!enabled) return { source: "scortonjs", status: "skipped", reason };
      try {
        const { stdout } = await client.score(domain);
        const json = extractJson(stdout);
        const score = pickScore(json);
        if (score === null) return { source: "scortonjs", status: "unscored", raw: json };
        return { source: "scortonjs", status: score >= minScore ? "trusted" : "low_trust", score, minScore };
      } catch (e) {
        return { source: "scortonjs", status: "error", message: String(e.message).slice(0, 200) };
      }
    },
  };
}
