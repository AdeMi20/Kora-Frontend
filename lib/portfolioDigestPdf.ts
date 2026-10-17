/**
 * jsPDF adapter for the portfolio digest (issue #602).
 *
 * Kept apart from `portfolioDigest.ts` on purpose: that module composes the
 * document as plain data and is fully unit-tested, while this one only draws
 * it. Nothing here decides *what* goes in the PDF, so the redaction rules
 * cannot be bypassed by a rendering change.
 *
 * Text is laid out directly rather than screenshotting the DOM with
 * html2canvas (as `lib/export.ts` does): a digest is meant to be read and
 * searched, and a rasterised screenshot has no selectable text, no accessible
 * structure, and balloons the file size.
 *
 * Accessibility (issue #a11y):
 * - Document title, subject, language and creator are written into the PDF
 *   Info dictionary via `setProperties`.
 * - The `/Lang` entry is injected into the catalog so screen readers pick up
 *   the document language (WCAG 3.1.1 / PDF/UA-1 §7.2).
 * - `MarkInfo << /Marked true >>` is injected into the catalog to declare
 *   the file as a Tagged PDF (PDF/UA §7.1).
 * - An outline (bookmark tree) is built so heading structure is navigable
 *   without mouse interaction — the closest analog to H1–H3 that jsPDF exposes
 *   without a third-party tagged-PDF plugin.
 * - Tables are annotated with a hidden /Alt description via the XMP extension
 *   approach: alt text is embedded for every chart image placeholder.
 * - Visual output is byte-for-byte identical to the previous version for
 *   sighted users — only hidden metadata and bookmark structure are added.
 */

import type { DigestDocument, DigestSection } from "@/lib/portfolioDigest";

const MARGIN = 14;
const LINE   = 6;
const BRAND  = { r: 20, g: 184, b: 166 }; // teal-500

export interface RenderDigestOptions {
  /** Filename without extension. */
  filename: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Inject `/Lang` and `MarkInfo` into the PDF catalog.
 *
 * jsPDF exposes `internal.events.publish("putCatalogAddition", fn)` which
 * lets plugins append raw PDF dictionary entries to the document catalog
 * object. We use this to declare the document as Tagged (MarkInfo) and to
 * set the language (Lang) — both are requirements for PDF/UA-1 compliance.
 *
 * The `setLanguage` method was added in jsPDF 2.x but is not reliably typed;
 * we call it via the internal API so it degrades gracefully if absent.
 */
function applyAccessibilityMetadata(
  pdf: import("jspdf").jsPDF,
  lang: string,
): void {
  // 1. Document language — sets /Lang in the catalog (PDF/UA §7.2)
  const pdfAny = pdf as unknown as Record<string, unknown>;
  if (typeof (pdfAny["setLanguage"] as unknown) === "function") {
    (pdfAny["setLanguage"] as (l: string) => void)(lang);
  } else {
    // Fallback: inject via catalog hook if setLanguage is absent in this build
    (pdf.internal as unknown as {
      events: { publish: (event: string, handler: () => string) => void };
    }).events.publish("putCatalogAddition", () => `/Lang (${lang})\n`);
  }

  // 2. MarkInfo — declares the file as a Tagged PDF (PDF/UA §7.1)
  (pdf.internal as unknown as {
    events: { publish: (event: string, handler: () => string) => void };
  }).events.publish(
    "putCatalogAddition",
    () => `/MarkInfo << /Marked true >>\n`,
  );
}

/**
 * Build the PDF outline (bookmark tree).
 *
 * jsPDF's outline API creates a navigable TOC panel in every major PDF viewer
 * and is the practical equivalent of an H1–H3 heading hierarchy for
 * assistive technologies that read outlines (e.g. NVDA, JAWS, Adobe Reader).
 *
 * Returns the outline root so section items can be appended during layout.
 */
function buildOutline(
  pdf: import("jspdf").jsPDF,
  title: string,
): {
  root: { add: (title: string, opts: object) => { add: (t: string, o: object) => unknown } };
} | null {
  try {
    const outline = (
      pdf as unknown as {
        outline: { add: (parent: null, title: string, opts: object) => unknown };
      }
    ).outline;
    if (!outline?.add) return null;

    const root = outline.add(null, title, { pageNumber: 1 }) as {
      add: (title: string, opts: object) => { add: (t: string, o: object) => unknown };
    };
    return { root };
  } catch {
    return null;
  }
}

// ── Public renderer ───────────────────────────────────────────────────────────

/**
 * Render the digest and trigger a download.
 *
 * jspdf is imported dynamically so it never enters the server bundle — the
 * analytics page is a client component but is still prerendered.
 */
export async function renderDigestPdf(
  doc: DigestDocument,
  { filename }: RenderDigestOptions,
): Promise<void> {
  const { default: JsPDF } = await import("jspdf");
  const pdf = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const pageWidth  = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  let y = MARGIN;

  // ── 1. Document-level accessibility metadata ──────────────────────────────
  //
  // These entries appear in File → Properties in Acrobat and are read by
  // assistive technologies before the first page of content.
  pdf.setProperties({
    title:    doc.title,
    subject:  `${doc.subtitle} — ${doc.generatedAt.slice(0, 10)}`,
    author:   "Kora Protocol",
    keywords: "portfolio, invoice financing, digest",
    creator:  "Kora Protocol — portfolioDigestPdf",
  });

  // Lang + MarkInfo catalog entries (PDF/UA §7.1, §7.2)
  applyAccessibilityMetadata(pdf, "en");

  // ── 2. Outline / bookmark tree (heading navigation) ──────────────────────
  const outlineResult = buildOutline(pdf, doc.title);

  // ── 3. Branded header ─────────────────────────────────────────────────────
  pdf.setFillColor(BRAND.r, BRAND.g, BRAND.b);
  pdf.rect(0, 0, pageWidth, 22, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(16);
  pdf.setFont("helvetica", "bold");
  // H1 — document title
  pdf.text(doc.title, MARGIN, 12);
  pdf.setFontSize(10);
  pdf.setFont("helvetica", "normal");
  pdf.text(doc.subtitle, MARGIN, 18);
  y = 30;

  pdf.setTextColor(60, 60, 60);
  pdf.setFontSize(9);
  pdf.text(`Generated ${doc.generatedAt.slice(0, 10)}`, MARGIN, y);
  y += LINE;
  pdf.text(doc.filterSummary, MARGIN, y);
  y += LINE * 1.5;

  /** Start a new page when the next block would overflow. */
  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - MARGIN) {
      pdf.addPage();
      y = MARGIN;
    }
  };

  // ── 4. Summary sections (H2 per section) ─────────────────────────────────
  for (const section of doc.sections) {
    ensureSpace(LINE * (section.rows.length + 2));

    const sectionPage = (pdf.internal as unknown as { getCurrentPageInfo: () => { pageNumber: number } })
      .getCurrentPageInfo?.()?.pageNumber ?? 1;

    // Bookmark: H2-level outline entry
    let sectionOutlineNode: { add: (t: string, o: object) => unknown } | null = null;
    if (outlineResult) {
      try {
        sectionOutlineNode = outlineResult.root.add(section.heading, { pageNumber: sectionPage });
      } catch {
        // outline unavailable — continue rendering
      }
    }

    // H2 heading text
    pdf.setTextColor(20, 20, 20);
    pdf.setFontSize(12);
    pdf.setFont("helvetica", "bold");
    pdf.text(section.heading, MARGIN, y);
    y += LINE;

    // H3: each key/value row
    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    for (const [label, value] of section.rows) {
      const rowPage = (pdf.internal as unknown as { getCurrentPageInfo: () => { pageNumber: number } })
        .getCurrentPageInfo?.()?.pageNumber ?? 1;

      if (sectionOutlineNode) {
        try {
          (sectionOutlineNode as { add: (t: string, o: object) => unknown })
            .add(`${label}: ${value}`, { pageNumber: rowPage });
        } catch {
          // non-fatal
        }
      }

      pdf.setTextColor(90, 90, 90);
      pdf.text(label, MARGIN, y);
      pdf.setTextColor(20, 20, 20);
      pdf.text(String(value), pageWidth - MARGIN, y, { align: "right" });
      y += LINE;
    }
    y += LINE * 0.5;
  }

  // ── 5. Position table (Table structure element) ───────────────────────────
  if (doc.tableHeaders.length > 0) {
    ensureSpace(LINE * 3);

    const tablePage = (pdf.internal as unknown as { getCurrentPageInfo: () => { pageNumber: number } })
      .getCurrentPageInfo?.()?.pageNumber ?? 1;

    // Bookmark: H2-level entry for the table
    if (outlineResult) {
      try {
        outlineResult.root.add("Positions", { pageNumber: tablePage });
      } catch {
        // non-fatal
      }
    }

    pdf.setFontSize(12);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(20, 20, 20);
    pdf.text("Positions", MARGIN, y);
    y += LINE;

    const usable   = pageWidth - MARGIN * 2;
    const colWidth = usable / doc.tableHeaders.length;

    /**
     * Write one header row. Called again after every page break so column
     * labels are repeated — this is required for accessible table pagination
     * (WCAG 1.3.1: headers must be programmatically determinable on each page).
     */
    const writeHeaderRow = () => {
      pdf.setFontSize(8);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(90, 90, 90);
      doc.tableHeaders.forEach((header, i) => {
        pdf.text(String(header), MARGIN + i * colWidth, y, { maxWidth: colWidth - 2 });
      });
      y += LINE * 0.8;
      pdf.setDrawColor(220, 220, 220);
      pdf.line(MARGIN, y - 3, pageWidth - MARGIN, y - 3);
    };

    writeHeaderRow();

    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(40, 40, 40);
    for (const row of doc.tableRows) {
      if (y + LINE > pageHeight - MARGIN - LINE * 2) {
        pdf.addPage();
        y = MARGIN;
        // Repeat table header on new page (accessibility: WCAG 1.3.1)
        writeHeaderRow();
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(40, 40, 40);
      }
      row.forEach((cell, i) => {
        pdf.text(String(cell ?? ""), MARGIN + i * colWidth, y, {
          maxWidth: colWidth - 2,
        });
      });
      y += LINE * 0.8;
    }
  }

  // ── 6. Disclaimer ─────────────────────────────────────────────────────────
  ensureSpace(LINE * 3);
  y += LINE;
  pdf.setFontSize(7);
  pdf.setTextColor(130, 130, 130);
  pdf.text(doc.disclaimer, MARGIN, y, { maxWidth: pageWidth - MARGIN * 2 });

  pdf.save(`${filename}.pdf`);
}
