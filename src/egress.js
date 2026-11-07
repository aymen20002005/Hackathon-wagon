import { findPII } from "./privacy.js";

export class EgressBlocked extends Error {
  constructor(label, types) {
    super(`Egress blocked on "${label}": ${types.join(", ")}`);
    this.label = label;
    this.types = types;
  }
}

// Every byte that leaves the machine goes through here: inspected, logged, then sent.
export function createEgress({ audit, transport }) {
  const log = [];
  const blocked = [];
  let needles = [];

  function guard(label, body, url = "") {
    const text = url + JSON.stringify(body);
    const lower = text.toLowerCase();
    const types = [
      ...findPII(text).map((p) => p.type),
      ...needles.filter((n) => lower.includes(n.toLowerCase())).map(() => "known-personal-value"),
    ];
    if (types.length) {
      const uniq = [...new Set(types)];
      blocked.push({ label, types: uniq });
      audit.append("egress.blocked", { label, types: uniq });
      throw new EgressBlocked(label, uniq);
    }
    log.push({ label, url, body });
    audit.append("egress.sent", { label, keys: Object.keys(body) });
  }

  return {
    log,
    blocked,
    setNeedles(list) {
      needles = list;
    },
    guard,
    async send({ label, url, body }) {
      guard(label, body, url);
      return transport(url, { method: "POST", body: JSON.stringify(body) });
    },
  };
}

export const liveTransport = (apiKey) => async (url, init) => {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};
