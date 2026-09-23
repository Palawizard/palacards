import { notFound } from "next/navigation";
import { NAV } from "@/lib/nav";

// Pages pas encore construites : elles arrivent phase par phase (voir docs/PLAN-V1.md).
const ITEMS = NAV.flatMap((g) => g.items);

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const item = ITEMS.find((n) => n.href === `/${section}`);
  if (!item) notFound();
  return (
    <div>
      <h1 className="page-title">{item.label}</h1>
      <p className="hatnote mt-2">Cette page arrive bientôt.</p>
    </div>
  );
}
