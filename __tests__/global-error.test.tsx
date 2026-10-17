import { describe, it, expect } from "vitest";

import GlobalError from "@/app/global-error";

/**
 * Smoke test for the root `global-error.tsx` boundary.
 *
 * The module replaces the root layout, so the thing worth pinning is that it
 * resolves and exposes a default component for Next.js to render — importing it
 * also proves the locale bundles it reads its copy from all carry the
 * `globalError` namespace.
 */
describe("app/global-error", () => {
  it("exports a default function component", () => {
    expect(typeof GlobalError).toBe("function");
  });
});
