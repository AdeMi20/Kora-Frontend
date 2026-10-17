"use client";

import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { useFeatureFlag } from "@/lib/featureFlags";

export const BATCH_ACTIONS_ENV_VAR = "NEXT_PUBLIC_ENABLE_BATCH_ACTIONS";
const FEATURE_FLAG_DOCS_URL =
  "https://github.com/OpenLedger-Foundation/Kora-Frontend/blob/main/docs/feature-flags.md";

/** Explains why batch actions are missing when the flag is off. */
export function BatchActionsDisabledNotice() {
  const t = useTranslations("smeDashboard");
  const enabled = useFeatureFlag("batch-actions");

  if (enabled) return null;

  return (
    <div
      role="note"
      className="mb-6 flex gap-3 rounded-lg border border-border bg-muted/40 p-4 text-sm"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div>
        <p className="font-medium text-foreground">{t("batch.disabledTitle")}</p>
        <p className="mt-1 text-muted-foreground">
          {t("batch.disabledDesc", { envVar: BATCH_ACTIONS_ENV_VAR })}{" "}
          <a
            href={FEATURE_FLAG_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            {t("batch.disabledDocs")}
          </a>
        </p>
      </div>
    </div>
  );
}
