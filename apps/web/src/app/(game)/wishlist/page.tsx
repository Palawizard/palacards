"use client";

import { Wishlist } from "@/components/Wishlist";

export default function WishlistPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="page-title">Wishlist</h1>
        <p className="hatnote mt-2">
          Les cartes que tu guettes. Tu es prévenu dès que l’une d’elles est mise en vente sur le marché.
        </p>
      </div>
      <Wishlist />
    </div>
  );
}
