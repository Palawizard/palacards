import { notFound } from "next/navigation";
import { CARDS_PER_PACK, MAX_STORED_PACKS } from "@palacards/game";
import { ServerStatus } from "@/components/ServerStatus";
import { NAV } from "@/lib/nav";

export function generateStaticParams() {
  return NAV.map((item) => ({ section: item.slug }));
}

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const item = NAV.find((n) => n.slug === section);
  if (!item) notFound();

  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 pt-10 text-center">
      <h1 className="text-4xl font-bold">{item.label}</h1>
      <p className="text-muted">{item.description}</p>
      {item.slug === "pulls" && (
        <p className="text-sm text-muted">
          {CARDS_PER_PACK} cartes par paquet · stock max {MAX_STORED_PACKS}
        </p>
      )}
      <p className="rounded-lg border border-dashed border-line px-4 py-2 text-sm text-muted">Page à construire</p>
      <ServerStatus />
    </div>
  );
}
