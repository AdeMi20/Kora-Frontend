import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "../route";
import { verifyCsrf } from "@/lib/csrf";
import { logger } from "@/lib/logger";

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
