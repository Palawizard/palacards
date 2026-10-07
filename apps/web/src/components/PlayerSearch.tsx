"use client";

import type { PlayerSuggestionDTO } from "@palacards/shared";
import { useId, useState, type KeyboardEvent } from "react";
import useSWR from "swr";
import { AvatarFace } from "@/components/Avatar";
import { useDebounced } from "@/lib/use-debounced";

/** Temporisation avant de demander les pseudos à l'API (ms). */
const SUGGEST_DELAY_MS = 200;
/** Caractères à taper avant les premières propositions. */
const SUGGEST_MIN_CHARS = 1;

/**
 * Champ de pseudo qui propose les joueurs pendant la frappe (début du pseudo d'abord, puis ceux qui le
 * contiennent ; les amis d'abord à égalité). Un clic, ou les flèches puis Entrée, remplit le champ avec le
 * pseudo choisi et appelle `onPick`. `excludeFriends` : ni les amis ni les demandes en cours (page Amis).
 */
export function PlayerSearch({
  value,
  onChange,
  onPick,
  excludeFriends = false,
  id,
  className = "field",
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  onPick?: (username: string) => void;
  excludeFriends?: boolean;
  id?: string;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const q = useDebounced(value.trim(), SUGGEST_DELAY_MS);
  const { data } = useSWR<PlayerSuggestionDTO[]>(
    open && q.length >= SUGGEST_MIN_CHARS
      ? `/players?q=${encodeURIComponent(q)}${excludeFriends ? "&exclude=friends" : ""}`
      : null,
    { keepPreviousData: true },
  );
  // Pseudo déjà complet et seul proposé : rien à suggérer de plus.
  const options = (data ?? []).filter((p) => !(data?.length === 1 && p.username === value.trim().toLowerCase()));
  const showList = open && value.trim().length >= SUGGEST_MIN_CHARS && options.length > 0;
  const current = Math.min(active, options.length - 1);

  function pick(p: PlayerSuggestionDTO) {
    onChange(p.username);
    setOpen(false);
    setActive(0);
    onPick?.(p.username);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (options.length) setActive((current + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
    } else if (e.key === "Enter" && showList) {
      // Entrée choisit la proposition en surbrillance (sans envoyer le formulaire autour).
      e.preventDefault();
      pick(options[current]!);
    } else if (e.key === "Escape" && showList) {
      e.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList ? `${listId}-${current}` : undefined}
        aria-label={ariaLabel}
        className={className}
        value={value}
        placeholder={placeholder}
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <ul id={listId} role="listbox" aria-label="Joueurs proposés" className="pc-listbox">
          {options.map((p, i) => (
            <li
              key={p.username}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === current}
              className="pc-option"
              // mousedown : le champ garde le focus (sinon la liste se ferme avant le clic).
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => setActive(i)}
              onClick={() => pick(p)}
            >
              <span
                aria-hidden
                className="grid size-6 shrink-0 place-items-center overflow-hidden rounded-full bg-panel-2 font-display text-xs"
              >
                <AvatarFace name={p.displayName} avatar={p.avatar} />
              </span>
              <span className="min-w-0 flex-1 truncate">
                <span className="font-semibold">{p.displayName}</span>
                {p.displayName.toLowerCase() !== p.username && <span className="text-faint"> @{p.username}</span>}
              </span>
              {p.friend && <span className="text-xs text-faint">ami</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
