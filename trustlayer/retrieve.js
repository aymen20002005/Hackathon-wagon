import { normalizeDomain } from "../src/privacy.js";
import { createEgress, liveTransport } from "../src/egress.js";

const MAX_BYTES = 1_000_000;
const LOCAL = new Set(["localhost", "127.0.0.1"]);

// Only allow-listed hosts are ever fetched; the demo defaults to team-owned local pages.
export function createRetriever({ allowedHosts, audit, apiKey = process.env.CONTEXT_DEV_API_KEY }) {
  const allowed = new Set(allowedHosts.map((h) => h.toLowerCase()));
  const egress = apiKey ? createEgress({ audit, transport: liveTransport(apiKey) }) : null;

  return async function retrieve(rawUrl) {
    const retrievedAt = new Date().toISOString();
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      return { ok: false, error: "invalid_url", message: "Not a valid URL", retrievedAt };
    }
    if (!["http:", "https:"].includes(url.protocol)) return { ok: false, error: "invalid_url", message: "Only http(s) URLs", retrievedAt };
    if (!allowed.has(url.host.toLowerCase())) {
      return { ok: false, error: "domain_not_allowed", message: `${url.host} is not on the allowed-domain list`, retrievedAt, domain: normalizeDomain(url.host) };
    }

    if (LOCAL.has(url.hostname)) {
      try {
        const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return { ok: false, error: `http_${res.status}`, message: `Source returned HTTP ${res.status}`, retrievedAt, domain: url.hostname };
        const body = await res.text();
        if (body.length > MAX_BYTES) return { ok: false, error: "too_large", message: "Source too large", retrievedAt, domain: url.hostname };
        return { ok: true, url: url.href, domain: url.hostname, via: "direct fetch (team-owned test page)", kind: "html", body, retrievedAt };
      } catch (e) {
        return { ok: false, error: "fetch_failed", message: String(e.message).slice(0, 120), retrievedAt, domain: url.hostname };
      }
    }

    if (!egress) return { ok: false, error: "no_context_dev_key", message: "CONTEXT_DEV_API_KEY is required for non-local sources", retrievedAt, domain: url.hostname };
    try {
      const res = await egress.send({
        label: "context.dev/web.scrape",
        url: "https://api.context.dev/v1/web/scrape",
        body: { url: url.href, formats: { markdown: true }, sharedParams: { mainContentOnly: true } },
      });
      const md = res.json?.markdown;
      if (res.status !== 200 || !md?.success) return { ok: false, error: `context_dev_${res.status}`, message: "Context.dev could not retrieve the page", retrievedAt, domain: url.hostname };
      return { ok: true, url: url.href, domain: url.hostname, via: "Context.dev scrape", kind: "markdown", body: String(md.data).slice(0, MAX_BYTES), retrievedAt };
    } catch (e) {
      return { ok: false, error: "context_dev_failed", message: String(e.message).slice(0, 120), retrievedAt, domain: url.hostname };
    }
  };
}
