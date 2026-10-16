// SME batch-actions disabled notice — Issue #949.
import React from "react";
import { afterEach, describe, it, expect } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import {
  BatchActionsDisabledNotice,
  BATCH_ACTIONS_ENV_VAR,
} from "@/components/dashboard/BatchActionsDisabledNotice";
import { resetFeatureFlagOverrides, setFeatureFlagOverride } from "@/lib/featureFlags";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import ar from "@/messages/ar.json";
import ptBR from "@/messages/pt-BR.json";

const MESSAGES = { en, es, ar, "pt-BR": ptBR } as Record<string, Record<string, unknown>>;

function renderNotice(locale = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <BatchActionsDisabledNotice />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  act(() => resetFeatureFlagOverrides());
});

describe("BatchActionsDisabledNotice", () => {
  it("explains the flag and names the env var when batch actions are off", () => {
    setFeatureFlagOverride("batch-actions", false);
    renderNotice();

    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Batch actions are turned off");
    expect(note).toHaveTextContent(`${BATCH_ACTIONS_ENV_VAR}=true`);
    expect(screen.getByRole("link", { name: "Feature flag docs" })).toHaveAttribute(
      "href",
      expect.stringContaining("docs/feature-flags.md"),
    );
  });

  it("reacts to the flag being toggled at runtime", () => {
    setFeatureFlagOverride("batch-actions", false);
    renderNotice();
    expect(screen.getByRole("note")).toBeInTheDocument();

    act(() => setFeatureFlagOverride("batch-actions", true));
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});
