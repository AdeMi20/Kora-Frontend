import type { Metadata } from "next";
import { generateLocalizedMetadata } from "@/lib/localizedMetadata";

export function generateMetadata(): Promise<Metadata> {
  return generateLocalizedMetadata({
    key: "settings",
    path: "/settings",
    base: {
      // Personal preferences behind a wallet connection — nothing here belongs in
      // a search index, matching the transactions route.
      robots: { index: false, follow: false },
    },
  });
}

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
