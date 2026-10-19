/**
 * Unit tests for JSON-LD structured data builders (#1003).
 *
 * `lib/structuredData` reads NEXT_PUBLIC_APP_URL / NEXT_PUBLIC_APP_NAME at
 * import time, so every test stubs the env and re-imports the module.
 *
 * Usage sites:
 *   - app/layout.tsx               → websiteSchema, organizationSchema
 *   - app/marketplace/[id]/page.tsx → invoiceFinancialProductSchema, breadcrumbSchema
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { InvoiceSchemaInput } from "../structuredData";

const APP_URL = "https://test.kora.finance";
const APP_NAME = "Kora Test";

async function loadStructuredData(
  env: { NEXT_PUBLIC_APP_URL?: string; NEXT_PUBLIC_APP_NAME?: string } = {
    NEXT_PUBLIC_APP_URL: APP_URL,
    NEXT_PUBLIC_APP_NAME: APP_NAME,
  },
) {
  for (const key of ["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_APP_NAME"] as const) {
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  return import("../structuredData");
}

const INVOICE: InvoiceSchemaInput = {
  id: "inv-001",
  invoiceNumber: "INV-2024-001",
  debtorName: "Acme Logistics",
  amount: 25000,
  currency: "USDC",
  apr: 12.5,
  dueDate: "2025-03-31",
  jurisdiction: "NG",
  category: "Logistics",
  riskTier: "A",
};

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...originalEnv };
});

// ─── websiteSchema ────────────────────────────────────────────────────────────

describe("websiteSchema", () => {
  it("emits required schema.org WebSite fields", async () => {
    const { websiteSchema } = await loadStructuredData();
    const schema = websiteSchema();

    expect(schema["@context"]).toBe("https://schema.org");
    expect(schema["@type"]).toBe("WebSite");
    expect(schema.name).toBe(APP_NAME);
    expect(schema.url).toBe(APP_URL);
    expect(typeof schema.description).toBe("string");
    expect(schema.description.length).toBeGreaterThan(0);
  });

  it("builds an absolute SearchAction target from the app URL", async () => {
    const { websiteSchema } = await loadStructuredData();
    const { potentialAction } = websiteSchema();

    expect(potentialAction["@type"]).toBe("SearchAction");
    expect(potentialAction.target["@type"]).toBe("EntryPoint");
    expect(potentialAction.target.urlTemplate).toBe(
      `${APP_URL}/marketplace?q={search_term_string}`,
    );
    expect(potentialAction["query-input"]).toBe("required name=search_term_string");
  });

  it("falls back to the default URL and name when env is unset", async () => {
    const { websiteSchema } = await loadStructuredData({});
    const schema = websiteSchema();

    expect(schema.url).toBe("https://kora.finance");
    expect(schema.name).toBe("Kora Protocol");
  });

  it("does not throw when the env URL is not a valid URL", async () => {
    const { websiteSchema } = await loadStructuredData({
      NEXT_PUBLIC_APP_URL: "not-a-url",
      NEXT_PUBLIC_APP_NAME: APP_NAME,
    });

    expect(() => websiteSchema()).not.toThrow();
    expect(websiteSchema().url).toBe("not-a-url");
  });
});

// ─── organizationSchema ───────────────────────────────────────────────────────

describe("organizationSchema", () => {
  it("emits required schema.org Organization fields", async () => {
    const { organizationSchema } = await loadStructuredData();
    const schema = organizationSchema();

    expect(schema).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: APP_NAME,
      url: APP_URL,
    });
    expect(schema.description.length).toBeGreaterThan(0);
  });

  it("uses an absolute logo URL derived from the app URL", async () => {
    const { organizationSchema } = await loadStructuredData();
    const { logo } = organizationSchema();

    expect(logo).toBe(`${APP_URL}/icons/icon-512.png`);
    expect(() => new URL(logo)).not.toThrow();
  });

  it("lists absolute sameAs profile links", async () => {
    const { organizationSchema } = await loadStructuredData();
    const { sameAs } = organizationSchema();

    expect(sameAs.length).toBeGreaterThan(0);
    for (const link of sameAs) {
      expect(link).toMatch(/^https:\/\//);
    }
  });
});

// ─── invoiceFinancialProductSchema ────────────────────────────────────────────

describe("invoiceFinancialProductSchema", () => {
  it("emits required schema.org FinancialProduct fields", async () => {
    const { invoiceFinancialProductSchema } = await loadStructuredData();
    const schema = invoiceFinancialProductSchema(INVOICE);

    expect(schema["@context"]).toBe("https://schema.org");
    expect(schema["@type"]).toBe("FinancialProduct");
    expect(schema.name).toBe("Invoice INV-2024-001 — Acme Logistics");
    expect(schema.description).toBe(
      "Tokenized invoice from Acme Logistics. 12.50% APR, due 2025-03-31.",
    );
    expect(schema.annualPercentageRate).toBe(12.5);
    expect(schema.feesAndCommissionsSpecification).toBe("12.50% APR discount rate");
    expect(schema.category).toBe("Logistics");
    expect(schema.areaServed).toBe("NG");
  });

  it("builds an absolute marketplace URL for the invoice", async () => {
    const { invoiceFinancialProductSchema } = await loadStructuredData();
    const schema = invoiceFinancialProductSchema(INVOICE);

    expect(schema.url).toBe(`${APP_URL}/marketplace/inv-001`);
  });

  it("links the provider Organization to the app", async () => {
    const { invoiceFinancialProductSchema } = await loadStructuredData();
    const { provider } = invoiceFinancialProductSchema(INVOICE);

    expect(provider).toEqual({
      "@type": "Organization",
      name: APP_NAME,
      url: APP_URL,
    });
  });

  it("maps USDC to USD in the MonetaryAmount", async () => {
    const { invoiceFinancialProductSchema } = await loadStructuredData();
    const { amount } = invoiceFinancialProductSchema(INVOICE);

    expect(amount).toEqual({
      "@type": "MonetaryAmount",
      value: 25000,
      currency: "USD",
    });
  });

  it("passes non-USDC currencies through unchanged", async () => {
    const { invoiceFinancialProductSchema } = await loadStructuredData();
    const { amount } = invoiceFinancialProductSchema({ ...INVOICE, currency: "EURC" });

    expect(amount.currency).toBe("EURC");
  });

  it("keeps output well-formed when descriptive fields are empty", async () => {
    const { invoiceFinancialProductSchema, serializeSchema } = await loadStructuredData();
    const schema = invoiceFinancialProductSchema({
      ...INVOICE,
      jurisdiction: "",
      category: "",
      riskTier: "",
      dueDate: "",
    });

    expect(schema.category).toBe("");
    expect(schema.areaServed).toBe("");
    expect(schema.description).toBe("Tokenized invoice from Acme Logistics. 12.50% APR, due .");
    expect(() => JSON.parse(serializeSchema(schema))).not.toThrow();
  });

  it("does not leak riskTier into the public schema", async () => {
    const { invoiceFinancialProductSchema } = await loadStructuredData();
    const schema = invoiceFinancialProductSchema(INVOICE);

    expect(schema).not.toHaveProperty("riskTier");
  });
});

// ─── breadcrumbSchema ─────────────────────────────────────────────────────────

describe("breadcrumbSchema", () => {
  it("emits a BreadcrumbList with 1-based ListItem positions", async () => {
    const { breadcrumbSchema } = await loadStructuredData();
    const schema = breadcrumbSchema([
      { name: "Home", url: "/" },
      { name: "Marketplace", url: "/marketplace" },
      { name: "INV-2024-001", url: "/marketplace/inv-001" },
    ]);

    expect(schema["@context"]).toBe("https://schema.org");
    expect(schema["@type"]).toBe("BreadcrumbList");
    expect(schema.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: `${APP_URL}/` },
      { "@type": "ListItem", position: 2, name: "Marketplace", item: `${APP_URL}/marketplace` },
      {
        "@type": "ListItem",
        position: 3,
        name: "INV-2024-001",
        item: `${APP_URL}/marketplace/inv-001`,
      },
    ]);
  });

  it("leaves already-absolute URLs untouched", async () => {
    const { breadcrumbSchema } = await loadStructuredData();
    const schema = breadcrumbSchema([{ name: "Docs", url: "https://docs.kora.finance/start" }]);

    expect(schema.itemListElement[0].item).toBe("https://docs.kora.finance/start");
  });

  it("returns an empty list for no items", async () => {
    const { breadcrumbSchema } = await loadStructuredData();

    expect(breadcrumbSchema([]).itemListElement).toEqual([]);
  });
});

// ─── faqSchema ────────────────────────────────────────────────────────────────

describe("faqSchema", () => {
  it("emits a FAQPage whose entries are Question/Answer pairs", async () => {
    const { faqSchema } = await loadStructuredData();
    const schema = faqSchema();

    expect(schema["@context"]).toBe("https://schema.org");
    expect(schema["@type"]).toBe("FAQPage");
    expect(schema.mainEntity.length).toBeGreaterThan(0);

    for (const entry of schema.mainEntity) {
      expect(entry["@type"]).toBe("Question");
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.acceptedAnswer["@type"]).toBe("Answer");
      expect(entry.acceptedAnswer.text.length).toBeGreaterThan(0);
    }
  });

  it("has unique question names", async () => {
    const { faqSchema } = await loadStructuredData();
    const names = faqSchema().mainEntity.map((q) => q.name);

    expect(new Set(names).size).toBe(names.length);
  });
});

// ─── serializeSchema ──────────────────────────────────────────────────────────

describe("serializeSchema", () => {
  it("produces a valid JSON string that round-trips", async () => {
    const { serializeSchema, websiteSchema, organizationSchema, faqSchema } =
      await loadStructuredData();

    for (const schema of [websiteSchema(), organizationSchema(), faqSchema()]) {
      const json = serializeSchema(schema);
      expect(typeof json).toBe("string");
      expect(JSON.parse(json)).toEqual(schema);
    }
  });

  it("escapes characters that could break out of a <script> block", async () => {
    const { serializeSchema, invoiceFinancialProductSchema } = await loadStructuredData();
    const malicious = invoiceFinancialProductSchema({
      ...INVOICE,
      debtorName: '</script><script>alert("xss")</script>',
      category: "Food & <b>Beverage</b>",
    });

    const json = serializeSchema(malicious);

    expect(json).not.toContain("<");
    expect(json).not.toContain(">");
    expect(json).not.toContain("&");
    expect(json).not.toMatch(/<\/script/i);
    expect(json).toContain("\\u003c/script\\u003e");
    expect(json).toContain("\\u0026");
    // Escaping is lossless — crawlers parse back the original text.
    expect(JSON.parse(json)).toEqual(malicious);
  });

  it("escapes U+2028 / U+2029 line separators", async () => {
    const { serializeSchema } = await loadStructuredData();
    const json = serializeSchema({ text: "a\u2028b\u2029c" });

    expect(json).not.toContain("\u2028");
    expect(json).not.toContain("\u2029");
    expect(json).toContain("\\u2028");
    expect(json).toContain("\\u2029");
    expect(JSON.parse(json)).toEqual({ text: "a\u2028b\u2029c" });
  });
});
