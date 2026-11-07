import { redactPII } from "../src/privacy.js";

export const SCHEMA = ["name", "industry", "founded_year", "headquarters", "employees", "annual_revenue"];

const CAP = "[A-Z][\\p{L}'-]*(?:\\s[A-Z][\\p{L}'-]*)*";
const RULES = {
  industry: /\bindustry:\s*([^.\n]{3,60})/i,
  founded_year: /\b(?:founded|established)\s+in\s+(\d{4})\b/i,
  headquarters: new RegExp(`\\b(?:[Hh]eadquartered|[Bb]ased)\\s+in\\s+(${CAP}(?:,\\s*${CAP})?)`, "u"),
  employees: /\b(\d[\d,]{0,8})\s+(?:employees|team members|staff members)\b/i,
  annual_revenue: /\bannual revenue(?:\s+of|\s+is|:)?\s*([$€£]\s?\d[\d.,]*\s?(?:billion|million|thousand|bn|m|k)?)/i,
};

const sentenceAt = (text, index) => {
  let pos = 0;
  for (const s of text.split(/(?<=[.!?])\s+/)) {
    if (index < pos + s.length) return s;
    pos += s.length + 1;
  }
  return text;
};

const excerpt = (text, index) => redactPII(sentenceAt(text, index)).slice(0, 220);

// Deterministic, schema-constrained proposer. Stands in for an LLM: the trust layer does not care who proposes.
export function proposeFields(blocks) {
  const out = Object.fromEntries(SCHEMA.map((f) => [f, []]));
  for (const b of blocks) {
    if (b.tag === "h1") out.name.push({ value: b.text.slice(0, 100), blockId: b.id, excerpt: redactPII(b.text).slice(0, 220) });
    for (const [field, re] of Object.entries(RULES)) {
      const m = re.exec(b.text);
      if (m) out[field].push({ value: m[1].trim(), blockId: b.id, excerpt: excerpt(b.text, m.index) });
    }
  }
  return out;
}

export function parseMoney(s) {
  const m = /([\d.,]+)\s?(billion|bn|million|m|thousand|k)?/i.exec(s.replace(/[$€£]/g, ""));
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  const mult = { billion: 1e9, bn: 1e9, million: 1e6, m: 1e6, thousand: 1e3, k: 1e3 }[(m[2] ?? "").toLowerCase()] ?? 1;
  return Number.isFinite(n) ? n * mult : null;
}

const fmt = (n) => Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

function plausibility(field, value, ctx) {
  if (field === "founded_year") {
    const y = Number(value);
    return y >= 1800 && y <= ctx.now.getFullYear() ? null : `Year ${value} is outside 1800–${ctx.now.getFullYear()}`;
  }
  if (field === "employees") {
    const n = Number(String(value).replace(/,/g, ""));
    return n >= 1 && n <= 5_000_000 ? null : `Headcount ${value} is implausible`;
  }
  if (field === "annual_revenue") {
    const rev = parseMoney(value);
    if (rev === null) return "Revenue could not be parsed";
    if (rev > 1e12) return `Revenue ${value} is implausibly large`;
    if (ctx.employees && rev / ctx.employees > 5_000_000) {
      return `${value} with ${ctx.employees} employees = ${fmt(rev / ctx.employees)} per employee`;
    }
  }
  return null;
}

// Every proposed value must pass every check; anything unsupported stays unknown or is rejected.
export function evaluateFields(candidates, blockInfo, { now, stale }) {
  const fields = [];
  let employees = null;
  for (const name of SCHEMA) {
    const cands = candidates[name];
    if (!cands.length) {
      fields.push({ name, value: null, status: "unknown", evidence: null, checks: [{ id: "evidence", pass: false, message: "No evidence on the page: left unknown, not invented" }] });
      continue;
    }
    const clean = cands.filter((c) => !blockInfo[c.blockId].tainted);
    const primary = clean[0] ?? cands[0];
    const distinct = [...new Set(clean.map((c) => c.value.toLowerCase()))];
    const plaus = clean.length ? plausibility(name, primary.value, { now, employees }) : null;

    const checks = [
      { id: "evidence", pass: true, message: "Evidence excerpt captured" },
      {
        id: "trusted_content",
        pass: clean.length > 0,
        message: clean.length ? "Evidence is in visible, clean content" : blockInfo[primary.blockId].hidden ? "Evidence only appears in hidden content" : "Evidence only appears in content flagged as injection",
      },
      { id: "consistent", pass: distinct.length <= 1, message: distinct.length <= 1 ? "No conflicting values" : `Conflicting values: ${clean.map((c) => c.value).join(" vs ")}` },
      { id: "plausible", pass: !plaus, message: plaus ?? "Plausible" },
      { id: "fresh", pass: !stale, message: stale ? "Source page is stale" : "Source is not stale" },
    ];
    const status = checks.every((c) => c.pass) ? "accepted" : "rejected";
    if (name === "employees" && status === "accepted") employees = Number(primary.value.replace(/,/g, ""));
    fields.push({
      name,
      value: primary.value,
      status,
      evidence: { blockId: primary.blockId, excerpt: primary.excerpt },
      checks,
      alternatives: distinct.length > 1 ? clean.map((c) => c.value) : undefined,
    });
  }
  return fields;
}
