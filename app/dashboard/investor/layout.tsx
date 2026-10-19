import type { Metadata } from "next";
import { ContractEventSubscriber } from "@/components/marketplace/ContractEventSubscriber";
import { generateLocalizedMetadata } from "@/lib/localizedMetadata";

export function generateMetadata(): Promise<Metadata> {
  return generateLocalizedMetadata({
    key: "investorDashboard",
    path: "/dashboard/investor",
    base: {
      keywords: [
        "investor dashboard",
        "portfolio tracker",
        "DeFi yield",
        "invoice financing",
        "Stellar",
      ],
      robots: { index: false, follow: false },
    },
  });
}

import { ConnectWalletGuard } from "@/components/layout/ConnectWalletGuard";

export default function InvestorDashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConnectWalletGuard>
      <ContractEventSubscriber />
      {children}
    </ConnectWalletGuard>
  );
}
