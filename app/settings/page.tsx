"use client";

import { Settings as SettingsIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Container } from "@/components/layout/Container";
import { ConcentrationThresholdSettings } from "@/components/settings/ConcentrationThresholdSettings";
import { NotificationSettings } from "@/components/settings/NotificationSettings";
import { useWallet } from "@/hooks/useWallet";
import { useUIStore } from "@/store";

/**
 * Routable settings surface (Issue #638).
 *
 * These preferences previously existed only inside the wallet dropdown's
 * dialog, which meant they could not be linked to — no deep link from an
 * onboarding flow, no bookmark, no "see Settings" reference in docs or support.
 *
 * This page composes the same `NotificationSettings` component the dialog
 * renders, backed by the same `settingsStore`, so the two surfaces are one
 * state rather than two copies that can disagree. The wallet dropdown is kept
 * as a shortcut.
 */
export default function SettingsPage() {
  const t = useTranslations("settings");
  const { isConnected } = useWallet();
  const { setWalletModalOpen } = useUIStore();

  // Preferences are stored per wallet, so there is nothing meaningful to show
  // — or to save against — while disconnected.
  if (!isConnected) {
    return (
      <Container className="py-10">
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <SettingsIcon className="h-6 w-6 text-muted-foreground" aria-hidden />
          </div>
          <h1 className="text-xl font-semibold text-foreground">{t("connectTitle")}</h1>
          <p className="max-w-sm text-sm text-muted-foreground">{t("connectDesc")}</p>
          <Button onClick={() => setWalletModalOpen(true)}>{t("connectCta")}</Button>
        </div>
      </Container>
    );
  }

  return (
    <Container className="py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <Card className="max-w-2xl">
        <CardContent className="p-6">
          <NotificationSettings />
        </CardContent>
      </Card>

      <Card className="mt-6 max-w-2xl">
        <CardContent className="p-6">
          <ConcentrationThresholdSettings />
        </CardContent>
      </Card>
    </Container>
  );
}
