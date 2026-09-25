"use client";

import { use } from "react";
import { CardSheetView } from "@/components/CardSheetView";

export default function CardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <CardSheetView id={id} />;
}
