import { InvestorDashboardSkeleton } from "@/components/ui/skeleton";

export default function InvestorDashboardLoading() {
  return (
    <div className="container mx-auto px-4 py-8">
      <InvestorDashboardSkeleton />
    </div>
  );
}
