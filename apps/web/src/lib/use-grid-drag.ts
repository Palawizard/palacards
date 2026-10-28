"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";

/** Glissement en cours : élément saisi, position du pointeur et emplacements mesurés au départ. */
export interface GridDrag {
  id: number;
  pointerId: number;
  /** Point de saisie dans l'élément. */
  grabX: number;
  grabY: number;
  /** Pointeur (coordonnées de la page). */
  x: number;
  y: number;
  /** Emplacement i de la grille (coordonnées de la page) : il ne bouge pas, seuls les éléments changent de place. */
  cells: DOMRect[];
}

const pageRect = (el: Element) => {
  const r = el.getBoundingClientRect();
  return new DOMRect(r.left + window.scrollX, r.top + window.scrollY, r.width, r.height);
};

export const moveItem = <T>(list: T[], from: number, to: number) => {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
};

/** Décalage à appliquer à l'élément saisi pour qu'il suive le pointeur depuis sa place i. */
export function dragTransform(drag: GridDrag, i: number) {
  const cell = drag.cells[i];
  if (!cell) return undefined;
  return `translate(${drag.x - drag.grabX - cell.left}px, ${drag.y - drag.grabY - cell.top}px) scale(1.04) rotate(-1.5deg)`;
}

/**
 * Réorganisation d'une grille à la poignée (souris et tactile), comme la vitrine du profil : l'élément suit
 * le pointeur, les autres se poussent, Échap annule. `onDrop` reçoit le nouvel ordre s'il a changé.
 */
export function useGridDrag<T>({
  order,
  setOrder,
  synced,
  idOf,
  onDrop,
}: {
  order: T[];
  setOrder: Dispatch<SetStateAction<T[]>>;
  /** Ordre enregistré (retour en cas d'annulation). */
  synced: T[];
  idOf: (item: T) => number;
  onDrop: (next: T[], before: T[], moved: T) => void;
}) {
  const [drag, setDrag] = useState<GridDrag | null>(null);
  const cells = useRef(new Map<number, HTMLElement>());

  // Les écouteurs vivent sur la fenêtre : l'élément change de place dans le DOM pendant le geste, ce qui
  // ferait perdre la capture du pointeur à sa poignée.
  const live = useRef({ order, synced, drag, idOf, onDrop });
  useLayoutEffect(() => {
    live.current = { order, synced, drag, idOf, onDrop };
  });
  const dragging = drag?.id ?? null;
  useEffect(() => {
    if (dragging === null) return;
    const onMove = (e: PointerEvent) => {
      const { drag: d, order: o, idOf: id } = live.current;
      if (!d || e.pointerId !== d.pointerId) return;
      setDrag({ ...d, x: e.pageX, y: e.pageY });
      // Place visée : celle sous le pointeur, sinon la plus proche.
      let target = 0;
      let best = Infinity;
      d.cells.forEach((r, i) => {
        const inside = e.pageX >= r.left && e.pageX <= r.right && e.pageY >= r.top && e.pageY <= r.bottom;
        const dist = inside ? -1 : Math.hypot(e.pageX - (r.left + r.width / 2), e.pageY - (r.top + r.height / 2));
        if (dist < best) {
          best = dist;
          target = i;
        }
      });
      const from = o.findIndex((c) => id(c) === d.id);
      if (from !== target) setOrder(moveItem(o, from, target));
    };
    const onEnd = (e: PointerEvent) => {
      const { drag: d, order: o, synced: before, idOf: id, onDrop: drop } = live.current;
      if (!d || e.pointerId !== d.pointerId) return;
      setDrag(null);
      if (o.some((c, i) => before[i] === undefined || id(c) !== id(before[i]!)))
        drop(
          o,
          before,
          o.find((c) => id(c) === d.id)!,
        );
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setDrag(null);
      setOrder(live.current.synced);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      window.removeEventListener("keydown", onKey);
    };
  }, [dragging, setOrder]);

  function startDrag(e: ReactPointerEvent<HTMLElement>, item: T) {
    if (drag || (e.pointerType === "mouse" && e.button !== 0)) return;
    const cell = cells.current.get(idOf(item));
    if (!cell) return;
    e.preventDefault();
    const rect = pageRect(cell);
    setDrag({
      id: idOf(item),
      pointerId: e.pointerId,
      grabX: e.pageX - rect.left,
      grabY: e.pageY - rect.top,
      x: e.pageX,
      y: e.pageY,
      cells: order.map((c) => pageRect(cells.current.get(idOf(c))!)),
    });
  }

  /** Ref à poser sur l'emplacement de chaque élément. */
  const cellRef = (id: number) => (el: HTMLElement | null) => {
    if (el) cells.current.set(id, el);
    else cells.current.delete(id);
  };

  return { drag, startDrag, cellRef };
}
