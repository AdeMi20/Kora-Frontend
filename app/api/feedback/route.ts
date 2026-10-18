import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { verifyCsrf } from "@/lib/csrf";

export interface FeedbackPayload {
  type: "bug" | "feature" | "other";
  title: string;
  description: string;
  screenshot?: string | null; // base64 data URL
  context: {
    url: string;
    walletAddress?: string | null;
    userAgent: string;
    timestamp: string;
  };
}

/**
 * POST /api/feedback
 * Accepts a feedback submission, logs it to the console, and optionally
 * forwards it to the GitHub Issues API when GITHUB_FEEDBACK_TOKEN and
 * GITHUB_FEEDBACK_REPO are set in the environment.
 *
 * GITHUB_FEEDBACK_REPO format: "owner/repo"
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const csrfError = verifyCsrf(req);
  if (csrfError) return csrfError;

  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const body = (await req.json()) as FeedbackPayload;

    // ── Basic validation ──────────────────────────────────────────────────────
    if (!body.type || !body.title?.trim() || !body.description?.trim()) {
      return NextResponse.json(
        { error: "type, title, and description are required", requestId },
        { status: 400 }
      );
    }

    const allowed = ["bug", "feature", "other"];
    if (!allowed.includes(body.type)) {
      return NextResponse.json({ error: "Invalid feedback type", requestId }, { status: 400 });
    }

    // ── Screenshot validation (Issue #959) ────────────────────────────────
    const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024; // 2 MiB
    const ALLOWED_SCREENSHOT_MIME = ["image/png", "image/jpeg", "image/webp"];
    if (body.screenshot) {
      const mimeMatch = body.screenshot.match(/^data:([^/]+\/[^;]+);/);
      const mime = mimeMatch?.[1];
      if (!mime || !ALLOWED_SCREENSHOT_MIME.includes(mime)) {
        return NextResponse.json(
          { error: "Screenshot must be a PNG, JPEG or WEBP image", requestId },
          { status: 400 }
        );
      }
      const base64 = body.screenshot.split(",")[1] ?? "";
      const approxBytes = Math.floor((base64.length * 3) / 4);
      if (approxBytes > MAX_SCREENSHOT_BYTES) {
        return NextResponse.json(
          { error: "Screenshot exceeds the 2 MiB size limit", requestId },
          { status: 400 }
        );
      }
    }

    // ── Console log (always) ──────────────────────────────────────────────────
    logger.info("Feedback received", {
      requestId,
      route: "/api/feedback",
      feedbackType: body.type,
      title: body.title,
      description: body.description,
      context: body.context,
      hasScreenshot: Boolean(body.screenshot),
    });

    // ── Optional: GitHub Issues API ───────────────────────────────────────────
    const ghToken = process.env.GITHUB_FEEDBACK_TOKEN;
    const ghRepo = process.env.GITHUB_FEEDBACK_REPO; // e.g. "org/kora-frontend"

    if (ghToken && ghRepo) {
      const labelMap: Record<FeedbackPayload["type"], string> = {
        bug: "bug",
        feature: "enhancement",
        other: "feedback",
      };

      const issueBody = [
        `**Type:** ${body.type}`,
        `**URL:** ${body.context.url}`,
        `**Wallet:** ${body.context.walletAddress ?? "not connected"}`,
        `**Browser:** ${body.context.userAgent}`,
        `**Submitted:** ${body.context.timestamp}`,
        "",
        "## Description",
        body.description,
        body.screenshot
          ? "\n> _Screenshot attached (base64 omitted from issue body)_"
          : "",
      ]
        .filter((l) => l !== undefined)
        .join("\n");

      const ghRes = await fetch(`https://api.github.com/repos/${ghRepo}/issues`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ghToken}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          title: `[${body.type.toUpperCase()}] ${body.title}`,
          body: issueBody,
          labels: [labelMap[body.type]],
        }),
      });

      if (!ghRes.ok) {
        const err = await ghRes.text();
        logger.error("GitHub Issues API error", { requestId, route: "/api/feedback", error: err });
        // Don't fail the user request — log and continue
      } else {
        const issue = await ghRes.json();
        logger.info("GitHub issue created", { requestId, route: "/api/feedback", issueUrl: issue.html_url });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("Feedback submission error", { requestId, route: "/api/feedback", error: err });
    return NextResponse.json({ error: "Server error", requestId }, { status: 500 });
  }
}
