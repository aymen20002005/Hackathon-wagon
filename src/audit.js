import { createHash } from "node:crypto";

const sha = (s) => createHash("sha256").update(s).digest("hex");

export const sha256 = sha;

// Hash-chained log: editing, removing or reordering any entry breaks verify().
export class AuditLog {
  entries = [];

  append(event, data = {}) {
    const prev = this.entries.at(-1)?.hash ?? "GENESIS";
    const body = { seq: this.entries.length, ts: new Date().toISOString(), event, data, prev };
    const entry = { ...body, hash: sha(JSON.stringify(body)) };
    this.entries.push(entry);
    return entry;
  }

  static verify(entries) {
    let prev = "GENESIS";
    for (const [i, entry] of entries.entries()) {
      const { hash, ...body } = entry;
      if (body.prev !== prev || sha(JSON.stringify(body)) !== hash) return { ok: false, brokenAt: i };
      prev = hash;
    }
    return { ok: true, brokenAt: null };
  }
}
