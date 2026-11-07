const BASE = "https://api.context.dev/v1";

// Thin REST client: all calls go through the egress guard, and only a domain is ever sent.
export function createContextDev({ egress, zdr = false }) {
  const zdrField = zdr ? { zdr: "enabled" } : {};
  return {
    brandByDomain: (domain) =>
      egress.send({
        label: "context.dev/brand.retrieve",
        url: `${BASE}/brand/retrieve`,
        body: { type: "by_domain", domain, ...zdrField },
      }),

    answers: (domain) =>
      egress.send({
        label: "context.dev/web.answers",
        url: `${BASE}/web/answers`,
        body: {
          mode: "fast",
          task: `Find the headquarters country (ISO 3166-1 alpha-2 code), the founding year and a one-sentence description of the company that operates the website: ${domain}`,
          json_format: { headquarters_country_code: "", founded_year: 0, description: "" },
          timeoutOpts: { milliseconds: 30000, behavior: "return-partial" },
          ...zdrField,
        },
      }),
  };
}
