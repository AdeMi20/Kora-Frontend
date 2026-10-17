"use client";

/**
 * Concentration risk banner (issue #604).
 *
 * The allocation chart already shows *how* a portfolio splits; it shows a 70%
 * slice exactly as calmly as a 7% one. This surfaces the split as a warning
 * once it crosses the investor's configured threshold.
 *
 * All evaluation lives in `lib/concentrationRisk`. This component only renders
 * and wires the dismiss/snooze actions.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, X } from "lucide-react";

import {
  SNOOZE_DURATIONS_MS,
  evaluateConcentration,
  filterActiveAlerts,
  type ConcentrationPosition,
} from "@/lib/concentrationRisk";
import { marketplacePathForConcentration } from "@/lib/concentrationMarketplaceLink";
import { useSettingsStore } from "@/store/settingsStore";
import { Button } from "@/components/ui/button";

interface ConcentrationRiskAlertsProps {
  positions: ConcentrationPosition[];
  className?: string;
}

export function ConcentrationRiskAlerts({
  positions,
  className,
}: ConcentrationRiskAlertsProps) {
  const t = useTranslations("concentrationRisk");
  const concentration = useSettingsStore((s) => s.concentration);
  const dismiss = useSettingsStore((s) => s.dismissConcentrationAlert);
  const snooze = useSettingsStore((s) => s.snoozeConcentrationAlert);

  const alerts = useMemo(() => {
    const evaluated = evaluateConcentration(positions, concentration.thresholds);
    return filterActiveAlerts(
      evaluated,
      concentration.dismissedKeys,
      concentration.snoozes
    );
  }, [positions, concentration]);

  if (alerts.length === 0) return null;

  return (
    <section
      className={className}
      aria-label={t("title")}
      data-testid="concentration-risk-alerts"
    >
      <ul className="space-y-2">
        {alerts.map((alert) => (
          <li
            key={alert.key}
            role="alert"
            data-testid={`concentration-alert-${alert.key}`}
            className={
              alert.severity === "critical"
                ? "flex items-start gap-3 rounded-md border border-red-900/60 bg-red-950/30 p-3"
                : "flex items-start gap-3 rounded-md border border-amber-900/60 bg-amber-950/20 p-3"
            }
          >
            <AlertTriangle
              aria-hidden="true"
              className={
                alert.severity === "critical"
                  ? "mt-0.5 h-4 w-4 shrink-0 text-red-400"
                  : "mt-0.5 h-4 w-4 shrink-0 text-amber-400"
              }
            />

            <div className="min-w-0 flex-1">
              <p className="text-sm text-zinc-100">
                {t(alert.dimension, {
                  name: alert.name,
                  percent: alert.percent.toFixed(1),
                })}
              </p>
              <p className="text-xs text-zinc-400">
                {t("thresholdNote", { threshold: alert.threshold })}
              </p>

              <div className="mt-2 flex flex-wrap gap-2">
                <Button asChild size="sm" className="h-7 text-xs">
                  <Link
                    href={marketplacePathForConcentration(alert)}
                    data-testid={`concentration-cta-${alert.key}`}
                  >
                    {t("diversifyCta")}
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => snooze(alert.key, SNOOZE_DURATIONS_MS.day)}
                >
                  {t("snoozeDay")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => snooze(alert.key, SNOOZE_DURATIONS_MS.week)}
                >
                  {t("snoozeWeek")}
                </Button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => dismiss(alert.key)}
              aria-label={t("dismiss")}
              className="shrink-0 rounded p-1 text-zinc-400 hover:text-zinc-200"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default ConcentrationRiskAlerts;
