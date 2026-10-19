"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, FlaskConical, Lock, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FEATURE_FLAGS,
  getFeatureFlagOverride,
  isFlagOverrideAllowed,
  resetFeatureFlagOverrides,
  setFeatureFlagOverride,
  useFeatureFlags,
  type FeatureFlag,
} from "@/lib/featureFlags";
import { queryKeys } from "@/lib/queryKeys";

const FLAG_DESCRIPTIONS: Record<FeatureFlag, string> = {
  "mock-data": "Switch invoice queries between mock fixtures and live data.",
  devtools: "Show React Query and engineering-only diagnostics.",
  comparison: "Enable marketplace invoice comparison UI.",
  "onboarding-tour": "Mount the guided onboarding tour overlay.",
  "batch-actions": "Expose batch invoice management actions.",
  "kyb-mint-gate": "Gate invoice minting behind KYB verification.",
  "secondary-market": "Enable secondary market P2P trading route.",
  "category-taxonomy-preview": "Preview enhanced category taxonomy filters.",
};

const RESTRICTED_OVERRIDE_TOOLTIP =
  "Runtime overrides for this flag are disabled outside local development " +
  "to avoid live/demo mode confusion on shared hosts. Set its NEXT_PUBLIC_ENABLE_* env var instead.";

export function FeatureFlagPanel() {
  const panelEnabled =
    process.env.NODE_ENV === "development" ||
    process.env.NEXT_PUBLIC_ENABLE_DEVTOOLS === "true";

  if (!panelEnabled) return null;

  return <FeatureFlagPanelInner />;
}

function FeatureFlagPanelInner() {
  const flags = useFeatureFlags();
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);

  const handleOverrideChange = (flag: FeatureFlag, enabled: boolean) => {
    if (!isFlagOverrideAllowed(flag)) return;
    setFeatureFlagOverride(flag, enabled);

    if (flag === "mock-data") {
      void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
    }
  };

  const handleReset = () => {
    resetFeatureFlagOverrides();
    void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
  };

  return (
    <aside
      data-testid="feature-flag-panel"
      className={cn(
        "fixed bottom-4 left-4 z-[9998] w-[22rem] rounded-2xl border shadow-2xl",
        "border-emerald-500/20 bg-zinc-950/95 text-zinc-100 backdrop-blur-md",
      )}
      role="region"
      aria-label="Feature flag devtools"
    >
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-300">
            <FlaskConical className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-wide">Feature Flags</p>
            <p className="text-[11px] text-zinc-400">
              Development-only runtime overrides
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleReset}
            className="rounded-md p-2 text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-100"
            aria-label="Reset feature flag overrides"
            title="Reset feature flag overrides"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="rounded-md p-2 text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-100"
            aria-expanded={!collapsed}
            aria-controls="feature-flag-panel-body"
            aria-label={collapsed ? "Expand feature flag panel" : "Collapse feature flag panel"}
          >
            {collapsed ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div id="feature-flag-panel-body" className="space-y-3 p-4">
          {FEATURE_FLAGS.map((flag) => {
            const override = getFeatureFlagOverride(flag);
            const source = override === undefined ? "env" : "override";
            const restricted = !isFlagOverrideAllowed(flag);
            const restrictionId = `feature-flag-${flag}-restriction`;

            return (
              <label
                key={flag}
                title={restricted ? RESTRICTED_OVERRIDE_TOOLTIP : undefined}
                className={cn(
                  "flex items-start justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-3 transition-colors",
                  restricted ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-zinc-700",
                )}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-100">{flag}</span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider",
                        source === "override"
                          ? "bg-emerald-500/10 text-emerald-300"
                          : "bg-zinc-800 text-zinc-400",
                      )}
                    >
                      {source}
                    </span>
                    {restricted && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-300"
                        title={RESTRICTED_OVERRIDE_TOOLTIP}
                      >
                        <Lock className="h-3 w-3" aria-hidden="true" />
                        locked
                      </span>
                    )}
                  </div>
                  <p className="text-xs leading-5 text-zinc-400">
                    {FLAG_DESCRIPTIONS[flag]}
                  </p>
                  {restricted && (
                    <p id={restrictionId} className="text-[11px] leading-4 text-amber-300/80">
                      {RESTRICTED_OVERRIDE_TOOLTIP}
                    </p>
                  )}
                </div>

                <input
                  type="checkbox"
                  checked={flags[flag]}
                  disabled={restricted}
                  aria-describedby={restricted ? restrictionId : undefined}
                  onChange={(event) =>
                    handleOverrideChange(flag, event.currentTarget.checked)
                  }
                  className="mt-1 h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-emerald-400 focus:ring-emerald-400 disabled:cursor-not-allowed"
                  aria-label={`Toggle ${flag}`}
                />
              </label>
            );
          })}
        </div>
      )}
    </aside>
  );
}
