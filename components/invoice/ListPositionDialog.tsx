"use client";

import { useState } from "react";
import { Tag, AlertCircle, CheckCircle, Info, AlertTriangle, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { computeImpliedDiscount } from "@/types/invoice";
import type { InvestorPosition } from "@/types/invoice";
import { useFormatters } from "@/hooks/useFormatters";

interface ListPositionDialogProps {
  position: InvestorPosition | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (askPrice: number, expiresAt?: string) => void;
}

/**
 * Listing form for the secondary market (#442): lets an investor set an ask
 * price for an active position and previews the implied discount before
 * submitting.
 */
export function ListPositionDialog({
  position,
  open,
  onOpenChange,
  onSubmit,
}: ListPositionDialogProps) {
  const [askPrice, setAskPrice] = useState<string>("");
  const [showValidation, setShowValidation] = useState(false);
  // Declared before the `!position` early return: the dialog mounts with a
  // null position and receives one when opened, so hook order must not change.
  const [expiresAt, setExpiresAt] = useState<string>("");
  const { formatCurrency, formatPercentage } = useFormatters();

  if (!position) return null;

  const currency = position.invoice?.metadata.currency ?? "USDC";
  const expectedReturn = position.expectedReturn;
  const parsedAsk = Number.parseFloat(askPrice);
  const askIsValid = Number.isFinite(parsedAsk) && parsedAsk > 0;

  // Validation: ask price must be reasonable (not too low, not excessively high)
  const minReasonablePrice = Math.max(1, expectedReturn * 0.1); // At least 10% of expected return
  const maxReasonablePrice = expectedReturn * 2; // Max 200% of expected return
  const priceIsReasonable = parsedAsk >= minReasonablePrice && parsedAsk <= maxReasonablePrice;

  const impliedDiscount = askIsValid
    ? computeImpliedDiscount(parsedAsk, expectedReturn)
    : null;

  // Validation states
  const isAskPriceValid = askIsValid && priceIsReasonable;
  const showValidationWarnings = showValidation || askPrice.length > 0;

const handleSubmit = () => {
    if (!isAskPriceValid) {
      setShowValidation(true);
      return;
    }
    onSubmit(parsedAsk, expiresAt || undefined);
    setAskPrice("");
    setExpiresAt("");
    setShowValidation(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-primary" aria-hidden />
            List position for sale
          </DialogTitle>
          <DialogDescription>
            Set an ask price for this position on the secondary market.
            Expected return: {formatCurrency(position.expectedReturn, currency)}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <NumberInput
            label="Ask price"
            placeholder={position.expectedReturn.toFixed(2)}
            value={askPrice}
            onChange={(e) => setAskPrice(e.target.value)}
            min={0}
            step="0.01"
            showUSDC={currency === "USDC"}
            error={
              showValidationWarnings && askPrice.length > 0 && !askIsValid
                ? "Enter a valid ask price greater than 0"
                : showValidationWarnings && askIsValid && !priceIsReasonable
                ? `Ask price must be between ${formatCurrency(Math.max(1, position.expectedReturn * 0.1), "USDC")} and ${formatCurrency(position.expectedReturn * 2, "USDC")}`
                : undefined
            }
          />

          {impliedDiscount !== null && (
            <div
              className={cn(
                "rounded-lg border border-border bg-muted/30 p-3",
                impliedDiscount >= 0
                  ? "border-success/30 bg-success/5"
                  : "border-warning/30 bg-warning/5"
              )}
            >
              <div className="flex items-start gap-2">
                {impliedDiscount >= 0 ? (
                  <CheckCircle className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
                )}
                <div className="flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Implied discount
                  </p>
                  <p
                    className={
                      impliedDiscount >= 0
                        ? "mt-1 text-lg font-bold text-success"
                        : "mt-1 text-lg font-bold text-warning"
                    }
                  >
                    {formatPercentage(impliedDiscount * 100, 2)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {impliedDiscount >= 0
                      ? "Buyer receives a discount versus your expected return."
                      : "You're asking above your expected return (premium)."}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Price range guidance */}
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <p className="text-xs text-muted-foreground">
                Suggested range:{" "}
                {formatCurrency(Math.max(1, position.expectedReturn * 0.1), "USDC")} -{" "}
                {formatCurrency(position.expectedReturn * 2, "USDC")}
              </p>
            </div>
          </div>

          {/* Expiry Date Picker */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-300">
              Listing Expiry (Optional)
            </label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400 pointer-events-none" />
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="pl-10 w-full rounded-lg border border-zinc-800 bg-zinc-900/80 text-sm text-white placeholder-zinc-500 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                min={new Date().toISOString().slice(0, 16)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Optional: listing will be automatically removed after this date
            </p>
          </div>

          {/* Validation warnings */}
          {showValidationWarnings && askPrice.length > 0 && !askIsValid && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <div className="flex items-center gap-2 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                <span>Please enter a valid ask price greater than 0</span>
              </div>
            </div>
          )}

          {showValidationWarnings && askIsValid && !priceIsReasonable && (
            <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
              <div className="flex items-center gap-2 text-xs text-warning">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                <span>
                  Ask price should be between{" "}
                  {formatCurrency(Math.max(1, expectedReturn * 0.1), "USDC")} and{" "}
                  {formatCurrency(expectedReturn * 2, "USDC")}
                </span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isAskPriceValid}>
            List for sale
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}