import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "../route";
import { verifyCsrf } from "@/lib/csrf";
import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";

vi.mock("@/lib/csrf", () => ({
  verifyCsrf: vi.fn(() => null),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

const ghFetch = vi.fn();
const originalFetch = globalThis.fetch;

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return {
    json: async () => body,
    headers: { get: (k: string) => headers[k] },
  } as unknown as Request;
}

beforeEach(() => {
  vi.mocked(verifyCsrf).mockReturnValue(null);
  ghFetch.mockReset();
  globalThis.fetch = ghFetch as any;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("POST /api/feedback (Issue #926)", () => {
  it("rejects missing required fields with 400", async () => {
    const res = await POST(makeRequest({}) as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("required");
  });

  it("rejects an invalid feedback type with 400", async () => {
    const res = await POST(
      makeRequest({ type: "spam", title: "t", description: "d" }) as any,
    );
    expect(res.status).toBe(400);
  });

  it("accepts a valid submission and does not call GitHub when env vars are absent", async () => {
    delete process.env.GITHUB_FEEDBACK_TOKEN;
    delete process.env.GITHUB_FEEDBACK_REPO;
    const res = await POST(
      makeRequest({
        type: "bug",
        title: "Something broke",
        description: "It broke badly",
        context: { url: "/", walletAddress: null, userAgent: "ua", timestamp: "t" },
      }) as any,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(ghFetch).not.toHaveBeenCalled();
  });

  it("forwards to the GitHub Issues API when env vars are set", async () => {
    process.env.GITHUB_FEEDBACK_TOKEN = "token";
    process.env.GITHUB_FEEDBACK_REPO = "org/repo";
    ghFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ html_url: "https://github.com/org/repo/issues/1" }),
    } as Response);
    const res = await POST(
      makeRequest({
        type: "feature",
        title: "Add feature",
        description: "Please add",
        screenshot: "data:image/png;base64,abc",
        context: {
          url: "/invoice/1",
          walletAddress: "0xalice",
          userAgent: "ua",
          timestamp: "t",
        },
      }) as any,
    );
    expect(res.status).toBe(200);
    expect(ghFetch).toHaveBeenCalledTimes(1);
    const [url, init] = ghFetch.mock.calls[0];
    expect(String(url)).toContain("repos/org/repo/issues");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.title).toBe("[FEATURE] Add feature");
    expect(body.labels).toEqual(["enhancement"]);
  });

  it("rejects a screenshot with a non-image MIME type", async () => {
    process.env.GITHUB_FEEDBACK_TOKEN = "token";
    process.env.GITHUB_FEEDBACK_REPO = "org/repo";
    const res = await POST(
      makeRequest({
        type: "bug",
        title: "t",
        description: "d",
        screenshot: "data:application/pdf;base64,abc",
        context: { url: "/", walletAddress: null, userAgent: "ua", timestamp: "t" },
      }) as any,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("PNG, JPEG or WEBP");
  });

  it("rejects an oversized screenshot", async () => {
    process.env.GITHUB_FEEDBACK_TOKEN = "token";
    process.env.GITHUB_FEEDBACK_REPO = "org/repo";
    const huge = "a".repeat(3_000_000); // ~2.25 MiB decoded
    const res = await POST(
      makeRequest({
        type: "bug",
        title: "t",
        description: "d",
        screenshot: `data:image/png;base64,${huge}`,
        context: { url: "/", walletAddress: null, userAgent: "ua", timestamp: "t" },
      }) as any,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("2 MiB");
  });
});

// ─── Payload validation matrix (Issue #1021) ──────────────────────────────────

/** Minimal payload that mirrors what FeedbackWidget submits. */
function widgetPayload(overrides: Record<string, unknown> = {}) {
  return {
    type: "bug",
    title: "Checkout button broken",
    description: "Clicking fund does nothing",
    screenshot: null,
    context: {
      url: "http://localhost/marketplace",
      walletAddress: null,
      userAgent: "Chrome 120",
      timestamp: "2026-01-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

function makeRawRequest(rawBody: string, opts: { csrf?: "valid" | "missing" | "mismatch" } = {}) {
  const headers = new Headers({ "Content-Type": "application/json", "x-request-id": "req-1021" });
  const token = crypto.randomUUID();
  if (opts.csrf === "valid") {
    headers.set("x-kora-csrf", token);
    headers.set("cookie", `__kora_csrf=${token}`);
  } else if (opts.csrf === "mismatch") {
    headers.set("x-kora-csrf", token);
    headers.set("cookie", `__kora_csrf=${crypto.randomUUID()}`);
  }
  return new NextRequest("http://localhost/api/feedback", {
    method: "POST",
    headers,
    body: rawBody,
  });
}

async function post(body: unknown) {
  const res = await POST(makeRequest(body) as any);
  return { status: res.status, json: await res.json() };
}

describe("POST /api/feedback payload validation (Issue #1021)", () => {
  beforeEach(() => {
    delete process.env.GITHUB_FEEDBACK_TOKEN;
    delete process.env.GITHUB_FEEDBACK_REPO;
    vi.mocked(logger.info).mockClear();
  });

  describe("required fields", () => {
    it.each([
      ["type", { type: undefined }],
      ["title", { title: undefined }],
      ["description", { description: undefined }],
      ["empty type", { type: "" }],
      ["whitespace title", { title: "   " }],
      ["whitespace description", { description: "\n\t  " }],
    ])("returns 400 when %s is missing", async (_label, overrides) => {
      const { status, json } = await post(widgetPayload(overrides));
      expect(status).toBe(400);
      expect(json.error).toContain("required");
    });

    it("returns 400 when description is only HTML that sanitizes to empty", async () => {
      const { status, json } = await post(widgetPayload({ description: "<b></b><i></i>" }));
      expect(status).toBe(400);
      expect(json.error).toContain("required");
    });

    it("includes the request id in validation errors", async () => {
      const res = await POST(makeRequest({}, { "x-request-id": "abc-123" }) as any);
      expect((await res.json()).requestId).toBe("abc-123");
    });
  });

  describe("type enum", () => {
    it.each(["bug", "feature", "other"])("accepts type %s", async (type) => {
      const { status } = await post(widgetPayload({ type }));
      expect(status).toBe(200);
    });

    it.each(["BUG", "spam", "question", "bug "])("rejects type %j", async (type) => {
      const { status, json } = await post(widgetPayload({ type }));
      expect(status).toBe(400);
      expect(json.error).toBe("Invalid feedback type");
    });
  });

  describe("max lengths (aligned with FeedbackWidget schema)", () => {
    it("accepts a title of exactly 120 characters", async () => {
      expect((await post(widgetPayload({ title: "t".repeat(120) }))).status).toBe(200);
    });

    it("rejects a title over 120 characters", async () => {
      const { status, json } = await post(widgetPayload({ title: "t".repeat(121) }));
      expect(status).toBe(400);
      expect(json.error).toContain("title");
    });

    it("accepts a description of exactly 2000 characters", async () => {
      expect((await post(widgetPayload({ description: "d".repeat(2000) }))).status).toBe(200);
    });

    it("rejects an oversized description", async () => {
      const { status, json } = await post(widgetPayload({ description: "d".repeat(2001) }));
      expect(status).toBe(400);
      expect(json.error).toContain("description");
    });

    it("rejects an oversized context field", async () => {
      const { status } = await post(
        widgetPayload({ context: { ...widgetPayload().context, userAgent: "u".repeat(5000) } }),
      );
      expect(status).toBe(400);
    });
  });

  describe("sanitization", () => {
    it("strips HTML tags from title and description before logging", async () => {
      const { status } = await post(
        widgetPayload({
          title: "<script>alert(1)</script>Broken",
          description: 'Bad <img src=x onerror="alert(1)">input',
        }),
      );
      expect(status).toBe(200);
      const meta = vi.mocked(logger.info).mock.calls[0][1] as Record<string, string>;
      expect(meta.title).toBe("alert(1)Broken");
      expect(meta.title).not.toContain("<");
      expect(meta.description).toBe("Bad input");
    });

    it("strips HTML before forwarding to GitHub", async () => {
      process.env.GITHUB_FEEDBACK_TOKEN = "token";
      process.env.GITHUB_FEEDBACK_REPO = "org/repo";
      ghFetch.mockResolvedValue({ ok: true, json: async () => ({ html_url: "x" }) } as Response);
      await post(widgetPayload({ title: "<b>Bold</b>", description: "<a href=javascript:x>link</a>" }));
      const sent = JSON.parse(ghFetch.mock.calls[0][1].body as string);
      expect(sent.title).toBe("[BUG] Bold");
      expect(sent.body).not.toContain("<a");
      expect(sent.body).toContain("link");
    });

    it("removes control characters but keeps line breaks", async () => {
      await post(widgetPayload({ description: "line one\u0000\u0007\nline two" }));
      const meta = vi.mocked(logger.info).mock.calls[0][1] as Record<string, string>;
      expect(meta.description).toBe("line one\nline two");
    });

    it("preserves unicode emoji in feedback text", async () => {
      const { status } = await post(
        widgetPayload({ title: "Love it 🚀🎉", description: "Great UX 👍 — ünïcödé ✓" }),
      );
      expect(status).toBe(200);
      const meta = vi.mocked(logger.info).mock.calls[0][1] as Record<string, string>;
      expect(meta.title).toBe("Love it 🚀🎉");
      expect(meta.description).toBe("Great UX 👍 — ünïcödé ✓");
    });
  });

  describe("unexpected JSON shapes", () => {
    it.each([
      ["null", null],
      ["an array", [widgetPayload()]],
      ["a string", "bug"],
      ["a number", 42],
    ])("returns 400 when the body is %s", async (_label, body) => {
      const { status, json } = await post(body);
      expect(status).toBe(400);
      expect(json.error).toBe("Request body must be a JSON object");
    });

    it("rejects unknown top-level fields", async () => {
      const { status, json } = await post(widgetPayload({ isAdmin: true }));
      expect(status).toBe(400);
      expect(json.error).toBe("Unexpected field: isAdmin");
    });

    it("rejects prototype-pollution style keys", async () => {
      const body = JSON.parse('{"type":"bug","title":"t","description":"d","__proto__":{"x":1}}');
      expect((await post(body)).status).toBe(400);
    });

    it.each([
      ["type", { type: ["bug"] }],
      ["title", { title: 123 }],
      ["description", { description: { text: "hi" } }],
    ])("rejects a non-string %s", async (field, overrides) => {
      const { status, json } = await post(widgetPayload(overrides));
      expect(status).toBe(400);
      expect(json.error).toBe(`${field} must be a string`);
    });

    it("rejects a non-string screenshot", async () => {
      const { status } = await post(widgetPayload({ screenshot: { data: "x" } }));
      expect(status).toBe(400);
    });

    it("rejects a non-object context", async () => {
      const { status, json } = await post(widgetPayload({ context: "http://evil" }));
      expect(status).toBe(400);
      expect(json.error).toBe("context must be an object");
    });

    it("rejects unknown context fields", async () => {
      const { status } = await post(
        widgetPayload({ context: { ...widgetPayload().context, cookie: "secret" } }),
      );
      expect(status).toBe(400);
    });

    it("rejects non-string context values", async () => {
      const { status } = await post(
        widgetPayload({ context: { ...widgetPayload().context, url: 42 } }),
      );
      expect(status).toBe(400);
    });
  });

  describe("malformed JSON", () => {
    it.each(["{not json", "", '{"type":"bug",', "undefined"])(
      "returns 400 for body %j",
      async (raw) => {
        const res = await POST(makeRawRequest(raw));
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toBe("Invalid JSON body");
        expect(json.requestId).toBe("req-1021");
      },
    );
  });

  describe("happy path", () => {
    it("returns 200 for a minimal payload (type, title, description only)", async () => {
      const { status, json } = await post({ type: "other", title: "Hi", description: "Hello" });
      expect(status).toBe(200);
      expect(json).toEqual({ success: true });
    });

    it("returns 200 for the full FeedbackWidget payload", async () => {
      const { status } = await post(
        widgetPayload({ context: { ...widgetPayload().context, walletAddress: "GABC" } }),
      );
      expect(status).toBe(200);
    });

    it("forwards a minimal payload to GitHub without crashing on missing context", async () => {
      process.env.GITHUB_FEEDBACK_TOKEN = "token";
      process.env.GITHUB_FEEDBACK_REPO = "org/repo";
      ghFetch.mockResolvedValue({ ok: true, json: async () => ({ html_url: "x" }) } as Response);
      const { status } = await post({ type: "bug", title: "t", description: "d" });
      expect(status).toBe(200);
      const sent = JSON.parse(ghFetch.mock.calls[0][1].body as string);
      expect(sent.body).toContain("**Wallet:** not connected");
    });

    it("still returns 200 when the GitHub API fails", async () => {
      process.env.GITHUB_FEEDBACK_TOKEN = "token";
      process.env.GITHUB_FEEDBACK_REPO = "org/repo";
      ghFetch.mockResolvedValue({ ok: false, text: async () => "rate limited" } as Response);
      const { status } = await post(widgetPayload());
      expect(status).toBe(200);
      expect(logger.error).toHaveBeenCalled();
    });

    it("returns 500 without leaking details when the network is offline", async () => {
      process.env.GITHUB_FEEDBACK_TOKEN = "token";
      process.env.GITHUB_FEEDBACK_REPO = "org/repo";
      ghFetch.mockRejectedValue(new TypeError("Failed to fetch"));
      const { status, json } = await post(widgetPayload());
      expect(status).toBe(500);
      expect(json.error).toBe("Server error");
    });
  });

  describe("CSRF protection", () => {
    beforeEach(async () => {
      const actual = await vi.importActual<typeof import("@/lib/csrf")>("@/lib/csrf");
      vi.mocked(verifyCsrf).mockImplementation(actual.verifyCsrf);
    });

    it("returns 403 when the CSRF token is missing", async () => {
      const res = await POST(makeRawRequest(JSON.stringify(widgetPayload())));
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("CSRF token missing");
    });

    it("returns 403 when the CSRF header and cookie do not match", async () => {
      const res = await POST(makeRawRequest(JSON.stringify(widgetPayload()), { csrf: "mismatch" }));
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("CSRF token mismatch");
    });

    it("checks CSRF before parsing the body", async () => {
      const res = await POST(makeRawRequest("{not json"));
      expect(res.status).toBe(403);
    });

    it("returns 200 with a matching CSRF token", async () => {
      const res = await POST(makeRawRequest(JSON.stringify(widgetPayload()), { csrf: "valid" }));
      expect(res.status).toBe(200);
    });
  });
});
