// Recorded-style fixtures so the demo works offline. Values are illustrative, not authoritative.
const BRANDS = {
  "stripe.com": {
    domain: "stripe.com",
    title: "Stripe",
    description: "Financial infrastructure platform for online payments.",
    address: { city: "South San Francisco", country_code: "US" },
    employees: { range: "5001 to 10000" },
    industries: { eic: [{ industry: "Finance", subindustry: "Payments & Money Movement" }] },
  },
  "lewagon.com": {
    domain: "lewagon.com",
    title: "Le Wagon",
    description: "Coding bootcamp teaching web development and data science.",
    address: { city: "Paris", country_code: "FR" },
    industries: { eic: [{ industry: "Education", subindustry: "Coding Bootcamps" }] },
  },
  "shopify.com": {
    domain: "shopify.com",
    title: "Shopify",
    description: "Commerce platform for online stores and point of sale.",
    address: { city: "Ottawa", country_code: "CA" },
    industries: { eic: [{ industry: "Software", subindustry: "E-commerce Platforms" }] },
  },
};

const ANSWERS = {
  "stripe.com": { headquarters_country_code: "US", founded_year: 2010, description: "Payments infrastructure company." },
  "lewagon.com": { headquarters_country_code: "FR", founded_year: 2013, description: "International coding bootcamp." },
  "shopify.com": { headquarters_country_code: "CA", founded_year: 2006, description: "E-commerce platform provider." },
};

export const mockTransport = async (url, init) => {
  const body = JSON.parse(init.body);
  if (url.endsWith("/brand/retrieve")) {
    const brand = BRANDS[body.domain];
    return brand
      ? { status: 200, json: { status: "ok", code: 200, brand: structuredClone(brand) } }
      : { status: 400, json: { status: "error", code: 400, error_code: "NOT_FOUND" } };
  }
  if (url.endsWith("/web/answers")) {
    const domain = body.task.split("website: ")[1];
    const content = ANSWERS[domain];
    return content
      ? { status: 200, json: { json_content: structuredClone(content), sources: [`https://${domain}`] } }
      : { status: 200, json: { json_content: {}, sources: [] } };
  }
  return { status: 404, json: null };
};
