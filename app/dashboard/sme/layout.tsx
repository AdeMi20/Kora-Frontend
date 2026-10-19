import type { Metadata } from "next";
import { generateLocalizedMetadata } from "@/lib/localizedMetadata";

export function generateMetadata(): Promise<Metadata> {
  return generateLocalizedMetadata({
    key: "smeDashboard",
    path: "/dashboard/sme",
    base: {
      keywords: [
        "SME dashboard",
        "invoice management",
        "invoice financing",
        "Stellar",
        "USDC liquidity",
      ],
      robots: { index: false, follow: false },
    },
  });
}

import { ContractEventSubscriber } from "@/components/marketplace/ContractEventSubscriber";

import { ConnectWalletGuard } from "@/components/layout/ConnectWalletGuard";

export default function SMEDashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConnectWalletGuard>
      <ContractEventSubscriber />
      {children}
    </ConnectWalletGuard>
  );
}