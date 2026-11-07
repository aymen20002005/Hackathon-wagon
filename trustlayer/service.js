import { createHash } from "node:crypto";
import { AuditLog } from "../src/audit.js";
import { findPII, redactPII } from "../src/privacy.js";
import { screenText } from "../src/screening.js";
import { createScorton } from "../src/trust.js";
import { htmlToBlocks, markdownToBlocks } from "./html.js";
import { createRetriever } from "./retrieve.js";
import { evaluateFields, proposeFields } from "./fields.js";

const STALE_MONTHS = 18;
const sha = (s) => createHash("sha256").update(s).digest("hex");
const stage = (name, state, summary) => ({ name, state, summary });
const SKIPPED = (names) => names.map((n) => stage(n, "skipped", "Not reached: earlier stage failed"));

export function createTrustLayer({ allowedHosts }) {
  let audit, retrieve, db, records, seq;
  const scorton = createScorton();

  function reset() {
    audit = new AuditLog();
    retrieve = createRetriever({ allowedHosts, audit });
    db = [];
    records = new Map();
    seq = 0;
  }
  reset();

  const publish = (rec, by) => {
    const fields = Object.fromEntries(
      rec.fields.filter((f) => f.status === "accepted").map((f) => [f.name, { value: f.value, source: rec.url, excerpt: f.evidence.excerpt, retrievedAt: rec.retrievedAt }]),
    );
    db.push({ recordId: rec.id, url: rec.url, publishedBy: by, fields });
  };

  async function enrich(url) {
    const rec = {
      id: `r${++seq}`, url: String(url).slice(0, 300), status: "failed", stages: [], blocks: [], fields: [], flags: [],
      pii: { emails: 0, phones: 0, other: 0 }, source: null, reasons: [], review: null, retrievedAt: null,
    };
    records.set(rec.id, rec);
    audit.append("input.received", { id: rec.id, url: rec.url });

    // 1. Acquire
    const page = await retrieve(rec.url);
    rec.retrievedAt = page.retrievedAt;
    if (!page.ok) {
      audit.append("retrieval.failed", { id: rec.id, error: page.error });
      rec.reasons = [page.message];
      rec.stages = [stage("Acquire", "fail", `${page.message}. No record fabricated.`), ...SKIPPED(["Isolate", "Extract", "Validate", "Govern"])];
      audit.append("decision", { id: rec.id, status: "failed", reasons: [page.error] });
      return rec;
    }
    const local = ["localhost", "127.0.0.1"].includes(page.domain);
    const trust = local ? { status: "skipped", reason: "team-owned local test page" } : await scorton.assess(page.domain);
    rec.source = { domain: page.domain, via: page.via, trust };
    audit.append("retrieval", { id: rec.id, url: page.url, via: page.via, retrievedAt: page.retrievedAt, bytes: page.body.length, sha256: sha(page.body) });
    const acquire = stage("Acquire", "ok", `Allowed domain, fetched via ${page.via}. Source trust (ScortonJS): ${trust.status}${trust.score != null ? ` ${trust.score}` : ""}.`);

    // 2. Isolate: retrieved text is data only; flag anything that tries to act like an instruction.
    const raw = page.kind === "html" ? htmlToBlocks(page.body) : markdownToBlocks(page.body);
    const info = {};
    for (const b of raw) {
      const patterns = screenText(b.text);
      info[b.id] = { hidden: b.hidden, patterns, tainted: b.hidden || patterns.length > 0 };
      if (patterns.length) rec.flags.push({ code: "prompt_injection", severity: "high", blockId: b.id, message: `Instruction-like content (${patterns.join(", ")}) kept out of trusted instructions` });
      else if (b.hidden) rec.flags.push({ code: "hidden_content", severity: "medium", blockId: b.id, message: "Content not visible to a human visitor" });
      for (const p of findPII(b.text)) rec.pii[p.type === "email" ? "emails" : p.type === "phone" ? "phones" : "other"]++;
    }
    const piiTotal = rec.pii.emails + rec.pii.phones + rec.pii.other;
    if (piiTotal) rec.flags.push({ code: "pii_in_source", severity: "info", message: `${piiTotal} personal value(s) found in the source: not in the schema, redacted from every output` });
    rec.blocks = raw.map((b) => ({ id: b.id, tag: b.tag, hidden: b.hidden, tainted: info[b.id].tainted, patterns: info[b.id].patterns, text: redactPII(b.text).slice(0, 400) }));

    const injected = rec.flags.filter((f) => f.code === "prompt_injection");
    const hidden = raw.filter((b) => b.hidden).length;
    audit.append("screening", { id: rec.id, blocks: raw.length, hidden, injected: injected.map((f) => f.blockId), pii: piiTotal });

    // Freshness
    let stale = false;
    const dateBlock = raw.find((b) => !info[b.id].tainted && /last updated:?\s*\d{4}-\d{2}-\d{2}/i.test(b.text));
    const now = new Date();
    if (dateBlock) {
      const d = new Date(/(\d{4}-\d{2}-\d{2})/.exec(dateBlock.text)[1]);
      const months = (now - d) / (1000 * 60 * 60 * 24 * 30.44);
      stale = months > STALE_MONTHS;
      if (stale) rec.flags.push({ code: "stale_source", severity: "medium", blockId: dateBlock.id, message: `Source last updated ${d.toISOString().slice(0, 10)} (older than ${STALE_MONTHS} months)` });
    } else {
      rec.flags.push({ code: "freshness_unknown", severity: "low", message: "No last-updated date on the page" });
    }

    const isolate = stage(
      "Isolate",
      injected.length ? "warn" : "ok",
      `${raw.length} blocks handled as untrusted data (${hidden} hidden). ${injected.length ? `${injected.length} injection payload(s) fenced off from instructions.` : "No instruction-like content."}`,
    );

    // 3. Extract
    const candidates = proposeFields(raw);
    const proposed = Object.values(candidates).filter((c) => c.length).length;
    for (const [field, list] of Object.entries(candidates)) {
      for (const c of list) audit.append("candidate", { id: rec.id, field, value: String(c.value).slice(0, 60), blockId: c.blockId, excerpt: c.excerpt.slice(0, 120) });
    }
    const extract = stage("Extract", "ok", `${proposed} of 6 schema fields proposed by a rule-based extractor (no tools, no instruction channel).`);

    // 4. Validate
    rec.fields = evaluateFields(candidates, info, { now, stale });
    for (const f of rec.fields) audit.append("checks", { id: rec.id, field: f.name, status: f.status, failed: f.checks.filter((c) => !c.pass).map((c) => c.id) });
    const n = (s) => rec.fields.filter((f) => f.status === s).length;
    const validate = stage("Validate", n("rejected") ? "warn" : "ok", `${n("accepted")} accepted, ${n("rejected")} rejected, ${n("unknown")} unknown. ${piiTotal} personal value(s) excluded.`);

    // 5. Govern: fail closed on any policy violation.
    if (injected.length) rec.reasons.push("Prompt injection payload detected in the retrieved content");
    for (const f of rec.fields.filter((x) => x.status === "rejected")) {
      rec.reasons.push(`${f.name} rejected: ${f.checks.filter((c) => !c.pass).map((c) => c.message).join("; ")}`);
    }
    if (stale) rec.reasons.push("Source page is stale");
    rec.status = rec.reasons.length ? "quarantined" : "approved";
    if (rec.status === "approved") publish(rec, "auto");
    const govern = stage("Govern", rec.status === "approved" ? "ok" : "warn", rec.status === "approved" ? `Approved: ${n("accepted")} evidenced field(s) published.` : "Quarantined: nothing published until a reviewer decides.");
    audit.append("decision", { id: rec.id, status: rec.status, reasons: rec.reasons.map((r) => r.slice(0, 120)) });

    rec.stages = [acquire, isolate, extract, validate, govern];
    return rec;
  }

  function review(id, decision, note = "") {
    const rec = records.get(id);
    if (!rec || rec.status !== "quarantined") throw new Error("Only quarantined records can be reviewed");
    if (!["approve", "reject"].includes(decision)) throw new Error("Invalid decision");
    if (decision === "approve") publish(rec, "reviewer");
    rec.status = decision === "approve" ? "published_after_review" : "rejected_by_reviewer";
    rec.review = { decision, note: redactPII(String(note)).slice(0, 200), published: decision === "approve" ? rec.fields.filter((f) => f.status === "accepted").map((f) => f.name) : [] };
    audit.append("review", { id, decision, published: rec.review.published, note: rec.review.note });
    return rec;
  }

  return {
    enrich,
    review,
    reset,
    state: () => ({ database: db, audit: audit.entries, auditValid: AuditLog.verify(audit.entries), records: [...records.values()].map((r) => ({ id: r.id, url: r.url, status: r.status })) }),
    audit: () => audit,
    scorton,
  };
}
