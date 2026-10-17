import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { SynapsKycModal } from "../SynapsKycModal";

const { setKycStatus } = vi.hoisted(() => ({ setKycStatus: vi.fn() }));

vi.mock("@/store/walletStore", () => ({
  useWalletStore: () => ({ setKycStatus }),
}));

function renderModal(locale: "en" | "es" = "en") {
  const messages = locale === "es" ? es : en;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <SynapsKycModal open onOpenChange={vi.fn()} />
    </NextIntlClientProvider>
  );
}

describe("SynapsKycModal i18n", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exposes the localized dialog title and description to screen readers", () => {
    renderModal("en");
    const dialog = screen.getByRole("dialog", { name: en.kyc.title });
    expect(dialog).toHaveAccessibleDescription(en.kyc.description);
  });

  it("renders the es locale shell", () => {
    renderModal("es");
    expect(screen.getByRole("dialog", { name: es.kyc.title })).toBeInTheDocument();
    expect(screen.getByText(es.kyc.intro.requirementsTitle)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: es.kyc.intro.start }));

    expect(screen.getByRole("group", { name: es.kyc.upload.docTypeLabel })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: es.kyc.upload.passport })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.queryByText(en.kyc.upload.passport)).not.toBeInTheDocument();
  });

  it("walks the failure and retry path with localized copy", () => {
    renderModal("es");
    fireEvent.click(screen.getByRole("button", { name: es.kyc.intro.start }));
    fireEvent.click(screen.getByRole("button", { name: es.kyc.upload.verifyFail }));

    expect(screen.getByRole("status")).toHaveTextContent(es.kyc.verifying.title);

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByRole("alert")).toHaveTextContent(es.kyc.failed.title);
    expect(setKycStatus).toHaveBeenLastCalledWith("rejected");

    fireEvent.click(screen.getByRole("button", { name: es.kyc.failed.retry }));
    expect(screen.getByRole("button", { name: es.kyc.upload.idCard })).toBeInTheDocument();
  });

  it("shows the localized success state", () => {
    renderModal("en");
    fireEvent.click(screen.getByRole("button", { name: en.kyc.intro.start }));
    fireEvent.click(screen.getByRole("button", { name: en.kyc.upload.verifySuccess }));

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText(en.kyc.success.title)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.kyc.success.continue })).toBeInTheDocument();
    expect(setKycStatus).toHaveBeenLastCalledWith("verified");
  });
});
