import { createHmac, randomBytes } from "node:crypto";

const SECRET = process.env.PSEUDONYM_SECRET || randomBytes(16).toString("hex");

// Stable, non-reversible token so logs can reference a person without containing their data.
export const pseudonym = (value, kind = "id") =>
  `${kind}_${createHmac("sha256", SECRET).update(String(value).toLowerCase()).digest("hex").slice(0, 8)}`;

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
// Word-boundary guards avoid matching digit runs inside hex hashes and identifiers.
const PHONE_RE = /(?<!\w)(?:\+|00)?\d[\d\s.()-]{7,}\d(?!\w)/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g;

export function findPII(text) {
  const found = [];
  for (const m of text.matchAll(EMAIL_RE)) found.push({ type: "email", value: m[0] });
  for (const m of text.matchAll(PHONE_RE)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 9 && digits.length <= 15 && !/^\d{4}-\d{2}-\d{2}/.test(m[0])) {
      found.push({ type: "phone", value: m[0] });
    }
  }
  for (const m of text.matchAll(IBAN_RE)) found.push({ type: "iban", value: m[0] });
  return found;
}

export function redactPII(text) {
  let out = text;
  for (const { type, value } of findPII(text)) out = out.split(value).join(`[${type} redacted]`);
  return out;
}

// Exact personal values of a record; any outbound payload containing one is a leak.
export const personalNeedles = (record) =>
  [record.contact_name, record.email, record.phone, record.notes].filter((v) => typeof v === "string" && v.trim().length >= 3);

const FREEMAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.fr", "outlook.com", "hotmail.com", "hotmail.fr",
  "live.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "orange.fr", "free.fr", "wanadoo.fr", "sfr.fr",
]);

const normalizeDomain = (d) =>
  String(d).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];

export { normalizeDomain };

// Data minimisation: the only thing allowed to leave is a company domain, never the person.
export function resolveCompanyDomain(record) {
  const raw = record.domain || record.email?.split("@")[1];
  if (!raw) return { domain: null, reason: "no-domain" };
  const domain = normalizeDomain(raw);
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return { domain: null, reason: "invalid-domain" };
  if (FREEMAIL.has(domain)) return { domain: null, reason: "personal-email-domain" };
  return { domain, reason: null };
}
