import { normalizeDomain } from "./privacy.js";
import { screenText } from "./screening.js";

const text = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

const field = (value, source, extra = {}) => ({ value, source, confidence: "medium", ...extra });

function scanInjection(candidates, issues, source) {
  const clean = {};
  for (const [key, value] of Object.entries(candidates)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && screenText(value).length) {
      issues.push({ code: "possible_prompt_injection", severity: "high", field: key, source });
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

export function validateBrand(requestedDomain, res) {
  const status = res?.status;
  const errorCode = res?.json?.error_code ?? "";
  if (status === 400 || status === 404) {
    if (/NOT_FOUND/.test(errorCode) || !errorCode) {
      return { outcome: "not_found", fields: {}, issues: [{ code: "not_found", severity: "info" }] };
    }
  }
  const brand = res?.json?.brand;
  if (status !== 200 || !brand) {
    return { outcome: "error", fields: {}, issues: [{ code: errorCode || `http_${status}`, severity: "high" }] };
  }
  if (normalizeDomain(brand.domain ?? "") !== normalizeDomain(requestedDomain)) {
    return {
      outcome: "rejected",
      fields: {},
      issues: [{ code: "domain_mismatch", severity: "high", detail: String(brand.domain).slice(0, 80) }],
    };
  }

  const issues = [];
  const clean = scanInjection(
    {
      title: text(brand.title, 100),
      description: text(brand.description, 500),
      slogan: text(brand.slogan, 200),
      city: text(brand.address?.city, 100),
      country_code: text(brand.address?.country_code, 2)?.toUpperCase(),
      employees_range: text(brand.employees?.range, 30),
      industry: text(brand.industries?.eic?.[0]?.industry, 100),
    },
    issues,
    "context.dev/brand",
  );

  const fields = {};
  for (const [k, v] of Object.entries(clean)) {
    // Context.dev advises verifying discovered addresses before relying on them.
    fields[k] = field(v, "context.dev/brand", ["city", "country_code"].includes(k) ? { needs_verification: true } : {});
  }
  return { outcome: "ok", fields, issues };
}

// Cross-check a second, independent research source against the brand profile.
export function crossCheckAnswers(res, fields, issues) {
  const content = res?.json?.json_content;
  if (res?.status !== 200 || !content) {
    issues.push({ code: "answers_unavailable", severity: "info" });
    return;
  }
  const sources = Array.isArray(res.json.sources) ? res.json.sources.slice(0, 5) : [];
  if (!sources.length) {
    issues.push({ code: "answer_without_sources", severity: "medium" });
    return;
  }

  const answer = scanInjection(
    {
      country_code: text(content.headquarters_country_code, 2)?.toUpperCase(),
      founded_year: Number.isInteger(content.founded_year) && content.founded_year > 1800 && content.founded_year <= new Date().getFullYear() ? content.founded_year : null,
      description: text(content.description, 500),
    },
    issues,
    "context.dev/answers",
  );

  if (answer.country_code && fields.country_code) {
    if (answer.country_code === fields.country_code.value) {
      fields.country_code.confidence = "high";
      fields.country_code.corroborated_by = sources;
    } else {
      delete fields.country_code;
      issues.push({ code: "cross_source_conflict", severity: "high", field: "country_code" });
    }
  }
  if (answer.founded_year) fields.founded_year = field(answer.founded_year, "context.dev/answers", { sources });
}

const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function checkNameConsistency(inputName, fields, issues) {
  if (!inputName || !fields.title) return;
  const a = squash(inputName);
  const b = squash(fields.title.value);
  if (a && b && !a.includes(b) && !b.includes(a)) {
    issues.push({ code: "name_mismatch", severity: "high", detail: "input company name differs from enriched title" });
  }
}
