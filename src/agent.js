import "./env.js";
import { AuditLog, sha256 } from "./audit.js";
import { createEgress, EgressBlocked } from "./egress.js";
import { createContextDev } from "./contextdev.js";
import { createScorton } from "./trust.js";
import { personalNeedles, pseudonym, resolveCompanyDomain } from "./privacy.js";
import { checkNameConsistency, crossCheckAnswers, validateBrand } from "./integrity.js";

export function createAgent({ transport, useAnswers = true, zdr = false, scorton = createScorton() }) {
  const audit = new AuditLog();
  const egress = createEgress({ audit, transport });
  const cdev = createContextDev({ egress, zdr });

  async function enrich(record) {
    audit.append("record.received", { id: record.id, subject: pseudonym(record.email ?? record.contact_name ?? record.id, "subj") });
    egress.setNeedles(personalNeedles(record));

    const { domain, reason } = resolveCompanyDomain(record);
    if (!domain) {
      audit.append("record.skipped", { id: record.id, reason });
      return { id: record.id, domain: null, status: "skipped", reason, fields: {}, issues: [], trust: null };
    }

    try {
      egress.guard("scortonjs/score", { target: domain });
      const trust = await scorton.assess(domain);
      audit.append("trust.assessed", { id: record.id, domain, status: trust.status, score: trust.score ?? null });

      const brand = validateBrand(domain, await cdev.brandByDomain(domain));
      const issues = [...brand.issues];
      const fields = brand.fields;

      if (brand.outcome === "ok") {
        if (useAnswers) crossCheckAnswers(await cdev.answers(domain), fields, issues);
        checkNameConsistency(record.company, fields, issues);
      }

      let status = brand.outcome === "ok" ? "enriched" : brand.outcome;
      if (status === "enriched" && issues.some((i) => i.severity === "high" || i.severity === "medium")) status = "needs_review";
      if (status === "enriched" && trust.status === "low_trust") status = "needs_review";

      audit.append("record.result", {
        id: record.id,
        domain,
        status,
        issues: issues.map((i) => i.code),
        resultHash: sha256(JSON.stringify(fields)),
      });
      return { id: record.id, domain, status, fields, issues, trust };
    } catch (e) {
      if (!(e instanceof EgressBlocked)) throw e;
      return { id: record.id, domain, status: "blocked", fields: {}, issues: [{ code: "egress_blocked", severity: "high" }], trust: null };
    }
  }

  return { enrich, egress, audit, scorton };
}
