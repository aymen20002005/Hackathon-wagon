import { AuditLog } from "../src/audit.js";
import { findPII } from "../src/privacy.js";
import { createTrustLayer } from "./service.js";

const field = (rec, name) => rec.fields.find((f) => f.name === name);
const flagCodes = (rec) => [...new Set(rec.flags.map((f) => f.code))];
const summary = (rec) =>
  `status=${rec.status}; accepted=[${rec.fields.filter((f) => f.status === "accepted").map((f) => f.name)}]; rejected=[${rec.fields.filter((f) => f.status === "rejected").map((f) => f.name)}]; flags=[${flagCodes(rec)}]`;

// Documented cases with expected and actual outcomes (deck: evaluation plan + MVP test pack).
export async function runTestPack({ baseUrl, allowedHosts }) {
  const layer = createTrustLayer({ allowedHosts });
  const page = (name) => `${baseUrl}/testpages/${name}`;
  const results = [];
  const add = (id, focus, title, expected, actual, pass) => results.push({ id, focus, title, expected, actual, pass: Boolean(pass) });

  const normal = await layer.enrich(page("orbis.html"));
  add("T01", "Functional", "Supported company page", "Approved; only fields with linked evidence are populated", summary(normal),
    normal.status === "approved" && normal.fields.filter((f) => f.status === "accepted").every((f) => f.evidence?.excerpt) && field(normal, "name").status === "accepted");
  add("T02", "Safety", "Missing value", "annual_revenue stays unknown, never invented", `annual_revenue=${field(normal, "annual_revenue").status}/${field(normal, "annual_revenue").value}`,
    field(normal, "annual_revenue").status === "unknown" && field(normal, "annual_revenue").value === null);
  add("T03", "Privacy", "PII in retrieved content", "PII detected in source; absent from record and database", `pii=${JSON.stringify(normal.pii)}; leaks=${findPII(JSON.stringify([normal, layer.state().database])).length}`,
    normal.pii.emails + normal.pii.phones >= 2 && findPII(JSON.stringify([normal, layer.state().database])).length === 0);

  const conflict = await layer.enrich(page("orbis-conflict.html"));
  add("T04", "Integrity", "Conflicting sources", "founded_year rejected, record routed to review", summary(conflict),
    field(conflict, "founded_year").status === "rejected" && conflict.status === "quarantined");

  const poison = await layer.enrich(page("orbis-poison.html"));
  add("T05", "Security", "Prompt injection (hidden payload)", "Payload flagged, record quarantined, nothing published", summary(poison),
    flagCodes(poison).includes("prompt_injection") && poison.status === "quarantined" && !layer.state().database.some((d) => d.recordId === poison.id));
  add("T06", "Integrity", "Unsupported revenue claim", "annual_revenue rejected as implausible", `annual_revenue=${field(poison, "annual_revenue").status}: ${field(poison, "annual_revenue").checks.filter((c) => !c.pass).map((c) => c.message)}`,
    field(poison, "annual_revenue").status === "rejected" && !field(poison, "annual_revenue").checks.find((c) => c.id === "plausible").pass);

  const hidden = await layer.enrich(page("orbis-hidden.html"));
  add("T07", "Security", "Claim only in hidden text", "Revenue rejected: evidence is not in trusted content", summary(hidden),
    field(hidden, "annual_revenue").status === "rejected" && !field(hidden, "annual_revenue").checks.find((c) => c.id === "trusted_content").pass && hidden.status === "quarantined");

  const injection = await layer.enrich(page("orbis-injection.html"));
  add("T08", "Security", "Prompt injection (visible text)", "Payload flagged and record quarantined", summary(injection),
    flagCodes(injection).includes("prompt_injection") && injection.status === "quarantined");

  const stale = await layer.enrich(page("orbis-stale.html"));
  add("T09", "Integrity", "Stale source", "Fields rejected, record quarantined", summary(stale),
    flagCodes(stale).includes("stale_source") && stale.status === "quarantined" && stale.fields.every((f) => f.status !== "accepted"));

  const sparse = await layer.enrich(page("orbis-sparse.html"));
  add("T10", "Safety", "Sparse page", "Only the name is populated; the rest stays unknown", summary(sparse),
    sparse.status === "approved" && sparse.fields.filter((f) => f.status === "unknown").length === 5);

  const missing = await layer.enrich(page("missing.html"));
  add("T11", "Reliability", "Source failure (404)", "Failed without fabricating a record", `status=${missing.status}; fields=${missing.fields.length}`,
    missing.status === "failed" && missing.fields.length === 0);

  const blocked = await layer.enrich("https://example.org/");
  add("T12", "Security", "Domain not on allow list", "Refused before any retrieval", `status=${blocked.status}; ${blocked.reasons[0]}`,
    blocked.status === "failed" && /allowed-domain/.test(blocked.reasons[0]));

  const a = createTrustLayer({ allowedHosts });
  const q1 = await a.enrich(page("orbis-poison.html"));
  a.review(q1.id, "approve", "Reviewed manually; contact camille.laurent@orbis-freight.example");
  const published = a.state().database.at(-1);
  add("T13", "Governance", "Reviewer approves a quarantined record", "Only accepted fields are published; rejected revenue stays out", `status=${q1.status}; published=[${Object.keys(published?.fields ?? {})}]`,
    q1.status === "published_after_review" && published && !("annual_revenue" in published.fields) && findPII(JSON.stringify(a.audit().entries)).length === 0);

  const q2 = await a.enrich(page("orbis-injection.html"));
  const before = a.state().database.length;
  a.review(q2.id, "reject");
  add("T14", "Governance", "Reviewer rejects a quarantined record", "Nothing is published", `status=${q2.status}; database size ${before} -> ${a.state().database.length}`,
    q2.status === "rejected_by_reviewer" && a.state().database.length === before);

  const entries = structuredClone(a.audit().entries);
  const ok = AuditLog.verify(entries).ok;
  entries[2].data.url = "http://tampered.example";
  const tampered = AuditLog.verify(entries);
  add("T15", "Audit", "Audit trace is tamper-evident", "Chain verifies; an edited entry is detected", `valid=${ok}; edit detected at #${tampered.brokenAt}`, ok && !tampered.ok);

  return { results, passed: results.filter((r) => r.pass).length, total: results.length };
}
