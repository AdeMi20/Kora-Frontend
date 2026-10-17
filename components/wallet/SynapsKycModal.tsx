"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useWalletStore } from "@/store/walletStore";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck, AlertCircle, FileText, Upload } from "lucide-react";

interface SynapsKycModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SynapsKycModal({ open, onOpenChange }: SynapsKycModalProps) {
  const t = useTranslations("kyc");
  const { setKycStatus } = useWalletStore();
  const [step, setStep] = useState<"intro" | "upload" | "verifying" | "success" | "failed">("intro");
  const [docType, setDocType] = useState<string>("passport");

  const startVerification = () => {
    setStep("upload");
  };

  const handleUpload = (simulateSuccess: boolean) => {
    setStep("verifying");
    setKycStatus("pending");
    setTimeout(() => {
      if (simulateSuccess) {
        setKycStatus("verified");
        setStep("success");
      } else {
        setKycStatus("rejected");
        setStep("failed");
      }
    }, 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-zinc-950 border border-zinc-850 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-zinc-100">
            {t("title")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("description")}
          </DialogDescription>
        </DialogHeader>

        {step === "intro" && (
          <div className="space-y-4 py-3">
            <p className="text-sm text-zinc-300 leading-relaxed">
              {t("intro.body")}
            </p>
            <div className="rounded-lg bg-zinc-900/60 border border-zinc-800 p-3.5 space-y-2">
              <p className="text-xs font-semibold text-zinc-200">{t("intro.requirementsTitle")}</p>
              <ul className="text-xs text-muted-foreground space-y-1.5 list-disc list-inside">
                <li>{t("intro.requirementId")}</li>
                <li>{t("intro.requirementSelfie")}</li>
                <li>{t("intro.requirementAddress")}</li>
              </ul>
            </div>
            <Button className="w-full mt-2" onClick={startVerification}>
              {t("intro.start")}
            </Button>
          </div>
        )}

        {step === "upload" && (
          <div className="space-y-4 py-3">
            <p id="kyc-doc-type-label" className="text-sm text-zinc-300 font-medium">{t("upload.docTypeLabel")}</p>
            <div role="group" aria-labelledby="kyc-doc-type-label" className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setDocType("passport")}
                aria-pressed={docType === "passport"}
                className={`p-3 rounded-lg border text-xs font-medium text-left transition-all ${
                  docType === "passport"
                    ? "border-primary bg-primary/5 text-foreground"
                    : "border-zinc-800 bg-zinc-900/20 text-zinc-400 hover:border-zinc-700 hover:text-zinc-350"
                }`}
              >
                <FileText className="h-4.5 w-4.5 mb-1.5 text-primary" aria-hidden />
                {t("upload.passport")}
              </button>
              <button
                type="button"
                onClick={() => setDocType("id_card")}
                aria-pressed={docType === "id_card"}
                className={`p-3 rounded-lg border text-xs font-medium text-left transition-all ${
                  docType === "id_card"
                    ? "border-primary bg-primary/5 text-foreground"
                    : "border-zinc-800 bg-zinc-900/20 text-zinc-400 hover:border-zinc-700 hover:text-zinc-350"
                }`}
              >
                <FileText className="h-4.5 w-4.5 mb-1.5 text-primary" aria-hidden />
                {t("upload.idCard")}
              </button>
            </div>

            <div className="border border-dashed border-zinc-800 rounded-lg p-6 flex flex-col items-center justify-center text-center bg-zinc-900/10">
              <Upload className="h-6 w-6 text-zinc-550 mb-2" aria-hidden />
              <p className="text-xs text-zinc-300">{t("upload.dropzone")}</p>
              <p className="text-[10px] text-zinc-500 mt-1">{t("upload.dropzoneHint")}</p>
            </div>

            <div className="flex gap-2.5 mt-4">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setStep("intro")}>
                {t("upload.back")}
              </Button>
              <Button type="button" className="flex-1" onClick={() => handleUpload(true)}>
                {t("upload.verifySuccess")}
              </Button>
              <Button type="button" variant="danger" className="flex-1 bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20" onClick={() => handleUpload(false)}>
                {t("upload.verifyFail")}
              </Button>
            </div>
          </div>
        )}

        {step === "verifying" && (
          <div role="status" aria-live="polite" className="flex flex-col items-center justify-center text-center py-8 space-y-4">
            <Loader2 className="h-10 w-10 animate-spin text-primary" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-zinc-200">{t("verifying.title")}</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs leading-relaxed">
                {t("verifying.body")}
              </p>
            </div>
          </div>
        )}

        {step === "success" && (
          <div className="flex flex-col items-center justify-center text-center py-6 space-y-4">
            <div className="h-12 w-12 rounded-full bg-success/10 text-success border border-success/20 flex items-center justify-center">
              <ShieldCheck className="h-6 w-6" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-205">{t("success.title")}</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs leading-relaxed">
                {t("success.body")}
              </p>
            </div>
            <Button type="button" className="w-full" onClick={() => onOpenChange(false)}>
              {t("success.continue")}
            </Button>
          </div>
        )}

        {step === "failed" && (
          <div role="alert" className="flex flex-col items-center justify-center text-center py-6 space-y-4">
            <div className="h-12 w-12 rounded-full bg-destructive/10 text-destructive border border-destructive/20 flex items-center justify-center">
              <AlertCircle className="h-6 w-6" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-205">{t("failed.title")}</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs leading-relaxed">
                {t("failed.body")}
              </p>
            </div>
            <Button type="button" className="w-full" onClick={() => setStep("upload")}>
              {t("failed.retry")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
