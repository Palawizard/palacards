import type { CaseTier } from "@palacards/game";
import "./cases.css";

/**
 * Une caisse dessinée : coffret d'album vu de face, couvercle plus clair, deux sangles et le sceau jaune
 * « P » des vignettes posé sur la fermeture. La couleur dit le niveau (bronze, argent, or, nuit étoilée
 * pour la légendaire). Purement décorative : le niveau est toujours écrit à côté.
 */
export function CaseBox({ tier, className = "" }: { tier: CaseTier; className?: string }) {
  return (
    <svg viewBox="0 0 120 100" aria-hidden className={`pc-case-box ${className}`} data-case={tier}>
      {/* Ombre portée. */}
      <ellipse cx="60" cy="94" rx="46" ry="4.5" fill="rgb(4 8 30 / 0.35)" />
      {/* Corps. */}
      <rect x="10" y="34" width="100" height="58" rx="7" fill="var(--case-body)" />
      <rect
        x="10"
        y="34"
        width="100"
        height="58"
        rx="7"
        fill="url(#pc-case-shade)"
        stroke="var(--case-edge)"
        strokeWidth="1.5"
      />
      {/* Couvercle. */}
      <path
        d="M14 14 H106 Q112 14 112 20 V38 H8 V20 Q8 14 14 14 Z"
        fill="var(--case-lid)"
        stroke="var(--case-edge)"
        strokeWidth="1.5"
      />
      <rect x="8" y="34" width="104" height="6" fill="var(--case-strap)" />
      {/* Sangles. */}
      <rect x="27" y="14" width="9" height="78" fill="var(--case-strap)" />
      <rect x="84" y="14" width="9" height="78" fill="var(--case-strap)" />
      {/* Rivets. */}
      {[
        [17, 46],
        [103, 46],
        [17, 84],
        [103, 84],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="2.2" fill="var(--case-rivet)" />
      ))}
      {tier === "legendary" &&
        [
          [48, 70, 3.4],
          [73, 80, 2.4],
          [66, 58, 1.8],
          [50, 24, 2],
        ].map(([x, y, s]) => (
          <path
            key={`${x}-${y}`}
            d="M12 0c.6 6.2 5.8 11.4 12 12-6.2.6-11.4 5.8-12 12-.6-6.2-5.8-11.4-12-12C6.2 11.4 11.4 6.2 12 0Z"
            transform={`translate(${x! - s!} ${y! - s!}) scale(${(s! * 2) / 24})`}
            fill="#fff3b0"
          />
        ))}
      {/* Reflet du couvercle. */}
      <path d="M16 18 H104" stroke="#fff" strokeOpacity="0.35" strokeWidth="2.5" strokeLinecap="round" />
      {/* Sceau. */}
      <circle cx="60" cy="38" r="15" fill="var(--color-accent)" stroke="var(--case-seal-ring)" strokeWidth="2.5" />
      <circle cx="60" cy="38" r="11" fill="none" stroke="rgb(31 22 0 / 0.28)" strokeWidth="1.5" strokeDasharray="3 3" />
      <text
        x="60"
        y="45.5"
        textAnchor="middle"
        fontSize="21"
        fill="var(--color-cover)"
        style={{ fontStretch: "62%", fontWeight: 800 }}
      >
        P
      </text>
      <defs>
        <linearGradient id="pc-case-shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.28" />
        </linearGradient>
      </defs>
    </svg>
  );
}
