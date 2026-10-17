"use client";

import { useTranslations } from "next-intl";
import { ErrorPage } from "@/components/ui/ErrorPage";

export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("settings.error");
  return (
    <ErrorPage
      error={error}
      reset={reset}
      title={t("title")}
      description={t("description")}
      boundary="SettingsError"
    />
  );
}
