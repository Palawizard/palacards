"use client";

import { use } from "react";
import { CardSheetView } from "@/components/CardSheetView";
import { RouteModal } from "@/components/RouteModal";

/**
 * Fiche carte ouverte depuis une vignette (navigation interne) : en fenêtre par-dessus l'écran en cours,
 * pour ne pas couper une ouverture de paquet. Un chargement direct de /card/[id] affiche la page complète.
 */
export default function CardModal({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <RouteModal>{(titleId) => <CardSheetView id={id} variant="modal" titleId={titleId} />}</RouteModal>;
}
