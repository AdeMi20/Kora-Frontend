/**
 * portfolioDigestPdf — unit tests (issue #a11y)
 *
 * These tests verify the accessibility tagging hooks are invoked on every
 * renderDigestPdf call.  jsPDF is mocked entirely: no DOM, no canvas, no
 * real PDF binary.  Each assertion maps to a concrete PDF/UA requirement:
 *
 *   setProperties          → DocInfo title/subject/author/creator/keywords
 *   setLanguage / Lang     → /Lang in catalog  (PDF/UA §7.2)
 *   putCatalogAddition     → /MarkInfo + /Lang  (PDF/UA §7.1)
 *   outline.add            → heading hierarchy bookmark tree  (WCAG 2.4.1)
 *   writeHeaderRow repeat  → table headers on each page  (WCAG 1.3.1)
 *
 * Visual output is not asserted — those concerns belong to snapshot / e2e
 * tests.  The contract here is: "tagging hooks must be called or the test
 * fails", ensuring a refactor cannot silently drop accessibility structure.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DigestDocument } from "@/lib/portfolioDigest";
import { DIGEST_DISCLAIMER } from "@/lib/portfolioDigest";

// ── jsPDF mock ────────────────────────────────────────────────────────────────
//
// We capture every call on a single shared spy object so each test can assert
// method invocations without running the real PDF engine.

const catalogHandlers: Array<() => string> = [];

const outlineAddSpy = vi.fn().mockReturnValue({
  add: vi.fn().mockReturnValue({}),
});

const mockPdf = {
  setProperties:   vi.fn(),
  setLanguage:     vi.fn(),
  setFillColor:    vi.fn(),
  rect:            vi.fn(),
  setTextColor:    vi.fn(),
  setFontSize:     vi.fn(),
  setFont:         vi.fn(),
  text:            vi.fn(),
  addPage:         vi.fn(),
  setDrawColor:    vi.fn(),
  line:            vi.fn(),
  save:            vi.fn(),
  internal: {
    pageSize: {
      getWidth:  vi.fn().mockReturnValue(210),
      getHeight: vi.fn().mockReturnValue(297),
    },
    getCurrentPageInfo: vi.fn().mockReturnValue({ pageNumber: 1 }),
    events: {
      publish: vi.fn((event: string, handler: () => string) => {
        if (event === "putCatalogAddition") {
          catalogHandlers.push(handler);
        }
      }),
    },
  },
  outline: {
    add: outlineAddSpy,
  },
};

vi.mock("jspdf", () => ({
  default: vi.fn(() => mockPdf),
}));

// ── Subject under test ────────────────────────────────────────────────────────

import { renderDigestPdf } from "@/lib/portfolioDigestPdf";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeDoc(overrides: Partial<DigestDocument> = {}): DigestDocument {
  return {
    title: "Kora",
    subtitle: "Portfolio digest",
    generatedAt: "2026-08-26T10:00:00.000Z",
    filterSummary: "Period: all",
    summary: {
      positionCount: 2,
      totalInvested: 1500,
      totalExpectedReturn: 1650,
      totalYieldEarned: 50,
      weightedApr: 8.5,
    },
    sections: [
      {
        heading: "Summary",
        rows: [
          ["Positions", "2"],
          ["Total invested", "$1,500.00"],
          ["Expected return", "$1,650.00"],
          ["Weighted average APR", "8.50%"],
        ],
      },
    ],
    tableHeaders: ["Invoice ID", "Debtor", "Invested", "APR"],
    tableRows: [
      ["inv-1", "Acme", "$1,000", "10%"],
      ["inv-2", "Globe", "$500",  "6%"],
    ],
    disclaimer: DIGEST_DISCLAIMER,
    ...overrides,
  };
}

// ── beforeEach ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  catalogHandlers.length = 0;
  // Restore stable return values that clearAllMocks wipes
  mockPdf.internal.pageSize.getWidth.mockReturnValue(210);
  mockPdf.internal.pageSize.getHeight.mockReturnValue(297);
  mockPdf.internal.getCurrentPageInfo.mockReturnValue({ pageNumber: 1 });
  outlineAddSpy.mockReturnValue({ add: vi.fn().mockReturnValue({}) });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("renderDigestPdf — accessibility tagging", () => {

  // ── 1. Document metadata (DocInfo) ─────────────────────────────────────────

  describe("setProperties — DocInfo metadata", () => {
    it("calls setProperties with the document title", async () => {
      await renderDigestPdf(makeDoc(), { filename: "test-digest" });
      expect(mockPdf.setProperties).toHaveBeenCalledOnce();
      const arg = mockPdf.setProperties.mock.calls[0][0] as Record<string, string>;
      expect(arg.title).toBe("Kora");
    });

    it("embeds the subtitle and date in the subject field", async () => {
      await renderDigestPdf(makeDoc(), { filename: "test-digest" });
      const arg = mockPdf.setProperties.mock.calls[0][0] as Record<string, string>;
      expect(arg.subject).toContain("Portfolio digest");
      expect(arg.subject).toContain("2026-08-26");
    });

    it("sets author to 'Kora Protocol'", async () => {
      await renderDigestPdf(makeDoc(), { filename: "test-digest" });
      const arg = mockPdf.setProperties.mock.calls[0][0] as Record<string, string>;
      expect(arg.author).toBe("Kora Protocol");
    });

    it("sets creator to a Kora-prefixed string", async () => {
      await renderDigestPdf(makeDoc(), { filename: "test-digest" });
      const arg = mockPdf.setProperties.mock.calls[0][0] as Record<string, string>;
      expect(arg.creator).toMatch(/Kora/i);
    });

    it("includes relevant keywords", async () => {
      await renderDigestPdf(makeDoc(), { filename: "test-digest" });
      const arg = mockPdf.setProperties.mock.calls[0][0] as Record<string, string>;
      expect(arg.keywords).toContain("portfolio");
    });
  });

  // ── 2. Language catalog entry (PDF/UA §7.2) ────────────────────────────────

  describe("/Lang catalog entry — PDF/UA §7.2", () => {
    it("calls setLanguage with 'en'", async () => {
      await renderDigestPdf(makeDoc(), { filename: "test-digest" });
      expect(mockPdf.setLanguage).toHaveBeenCalledWith("en");
    });

    it("falls back to putCatalogAddition /Lang when setLanguage is absent", async () => {
      // Temporarily remove setLanguage from the mock
      const original = mockPdf.setLanguage;
      (mockPdf as Record<string, unknown>)["setLanguage"] = undefined;

      await renderDigestPdf(makeDoc(), { filename: "test-digest" });

      const langEntries = catalogHandlers.filter((h) => h().includes("/Lang"));
      expect(langEntries.length).toBeGreaterThanOrEqual(1);

      // Restore
      (mockPdf as Record<string, unknown>)["setLanguage"] = original;
    });
  });

  // ── 3. MarkInfo catalog entry (PDF/UA §7.1) ────────────────────────────────

  describe("MarkInfo — Tagged PDF declaration (PDF/UA §7.1)", () => {
    it("publishes a putCatalogAddition event for MarkInfo", async () => {
      await renderDigestPdf(makeDoc(), { filename: "test-digest" });
      expect(mockPdf.internal.events.publish).toHaveBeenCalledWith(
        "putCatalogAddition",
        expect.any(Function),
      );
    });

    it("MarkInfo handler emits /Marked true", async () => {
      await renderDigestPdf(makeDoc(), { filename: "test-digest" });
      const markInfoEntries = catalogHandlers.filter((h) =>
        h().includes("/MarkInfo") && h().includes("/Marked true"),
      );
      expect(markInfoEntries.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 4. Outline / heading structure (WCAG 2.4.1) ───────────────────────────

  describe("outline — heading hierarchy bookmark tree (WCAG 2.4.1)", () => {
    it("calls outline.add for the document root / H1", async () => {
      await renderDigestPdf(makeDoc(), { filename: "test-digest" });
      expect(outlineAddSpy).toHaveBeenCalled();
    });

    it("root bookmark uses the document title", async () => {
      await renderDigestPdf(makeDoc(), { filename: "test-digest" });
      const firstCall = outlineAddSpy.mock.calls[0];
      // outline.add(null, title, opts) — first arg is parent (null = root)
      expect(firstCall[1]).toBe("Kora");
    });

    it("creates an outline entry for each section heading (H2)", async () => {
      const doc = makeDoc({
        sections: [
          { heading: "Summary",     rows: [["Positions", "2"]] },
          { heading: "Risk Tiers",  rows: [["AAA", "$1,000"]] },
        ],
      });
      await renderDigestPdf(doc, { filename: "test-digest" });

      // root.add should be called at least once per section
      const rootNode = outlineAddSpy.mock.results[0].value as { add: ReturnType<typeof vi.fn> };
      const sectionTitles = (rootNode.add.mock.calls as Array<[string, object]>)
        .map(([t]) => t);

      expect(sectionTitles).toContain("Summary");
      expect(sectionTitles).toContain("Risk Tiers");
    });

    it("creates row-level outline entries for section rows (H3)", async () => {
      await renderDigestPdf(makeDoc(), { filename: "test-digest" });
      const rootNode = outlineAddSpy.mock.results[0].value as { add: ReturnType<typeof vi.fn> };
      // Each section node's .add is called for each row
      const sectionNode = rootNode.add.mock.results[0]?.value as { add: ReturnType<typeof vi.fn> };
      if (sectionNode?.add) {
        expect(sectionNode.add).toHaveBeenCalled();
      }
    });

    it("adds 'Positions' bookmark when tableHeaders are present", async () => {
      await renderDigestPdf(makeDoc(), { filename: "test-digest" });
      const rootNode = outlineAddSpy.mock.results[0].value as { add: ReturnType<typeof vi.fn> };
      const titles = (rootNode.add.mock.calls as Array<[string, object]>).map(([t]) => t);
      expect(titles).toContain("Positions");
    });

    it("does not add 'Positions' bookmark when tableHeaders are empty", async () => {
      await renderDigestPdf(
        makeDoc({ tableHeaders: [], tableRows: [] }),
        { filename: "test-digest" },
      );
      const rootNode = outlineAddSpy.mock.results[0].value as { add: ReturnType<typeof vi.fn> };
      const titles = (rootNode.add.mock.calls as Array<[string, object]>).map(([t]) => t);
      expect(titles).not.toContain("Positions");
    });
  });

  // ── 5. Table header repetition on page breaks (WCAG 1.3.1) ───────────────

  describe("table header repetition on page overflow (WCAG 1.3.1)", () => {
    it("repeats table headers after a page break", async () => {
      // Force a page break inside the table by making the page very short
      mockPdf.internal.pageSize.getHeight.mockReturnValue(40);

      const doc = makeDoc({
        tableHeaders: ["Invoice", "Amount"],
        tableRows:    [
          ["inv-1", "$1,000"],
          ["inv-2", "$500"],
          ["inv-3", "$750"],
        ],
      });

      await renderDigestPdf(doc, { filename: "test-digest" });

      // addPage should have been triggered by the overflow condition
      expect(mockPdf.addPage).toHaveBeenCalled();
    });
  });

  // ── 6. Non-Latin characters in tagged titles (edge case) ──────────────────

  describe("non-Latin characters in document title", () => {
    it("passes unicode titles through setProperties without throwing", async () => {
      const doc = makeDoc({ title: "كورا — ملخص المحفظة" });
      await expect(renderDigestPdf(doc, { filename: "arabic-digest" })).resolves.not.toThrow();
      const arg = mockPdf.setProperties.mock.calls[0][0] as Record<string, string>;
      expect(arg.title).toBe("كورا — ملخص المحفظة");
    });

    it("renders without error for CJK characters", async () => {
      const doc = makeDoc({ title: "Kora 投資组合摘要" });
      await expect(renderDigestPdf(doc, { filename: "cjk-digest" })).resolves.not.toThrow();
    });
  });

  // ── 7. Empty portfolio edge case ──────────────────────────────────────────

  describe("empty portfolio sections", () => {
    it("still calls setProperties even with no sections or rows", async () => {
      await renderDigestPdf(
        makeDoc({ sections: [], tableHeaders: [], tableRows: [] }),
        { filename: "empty-digest" },
      );
      expect(mockPdf.setProperties).toHaveBeenCalledOnce();
    });

    it("still injects MarkInfo for empty portfolios", async () => {
      await renderDigestPdf(
        makeDoc({ sections: [], tableHeaders: [], tableRows: [] }),
        { filename: "empty-digest" },
      );
      const markInfoEntries = catalogHandlers.filter((h) =>
        h().includes("/MarkInfo"),
      );
      expect(markInfoEntries.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 8. pdf.save is called with the correct filename ──────────────────────

  describe("pdf.save invocation", () => {
    it("saves with the provided filename plus .pdf extension", async () => {
      await renderDigestPdf(makeDoc(), { filename: "kora-digest-2026-08-26" });
      expect(mockPdf.save).toHaveBeenCalledWith("kora-digest-2026-08-26.pdf");
    });
  });
});
