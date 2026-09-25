/** Seau à jetons : `capacity` événements d'un coup, puis `perSecond` par seconde. */
export interface BucketRule {
  capacity: number;
  perSecond: number;
}

/**
 * Limites par connexion et par événement client → serveur. `battle:join` touche la base à chaque appel ;
 * le marché s'abonne à toutes les ventes affichées (jusqu'à 200) d'un coup, puis s'en désabonne.
 */
export const SOCKET_LIMITS: Record<string, BucketRule> & { default: BucketRule } = {
  "battle:join": { capacity: 10, perSecond: 1 },
  "auction:watch": { capacity: 400, perSecond: 20 },
  "auction:unwatch": { capacity: 400, perSecond: 20 },
  default: { capacity: 20, perSecond: 2 },
};

/**
 * Limiteur d'une connexion : `allow(event)` consomme un jeton du seau de l'événement
 * et renvoie false quand il est vide (l'événement est alors ignoré).
 */
export function socketLimiter(rules: typeof SOCKET_LIMITS = SOCKET_LIMITS, now: () => number = Date.now) {
  const buckets = new Map<string, { tokens: number; at: number }>();
  return {
    allow(event: string): boolean {
      // Événement inconnu (nom choisi par le client) : seau commun, pour ne pas créer un seau par nom.
      const key = Object.hasOwn(rules, event) ? event : "default";
      const rule = rules[key]!;
      const t = now();
      const b = buckets.get(key) ?? { tokens: rule.capacity, at: t };
      b.tokens = Math.min(rule.capacity, b.tokens + ((t - b.at) / 1000) * rule.perSecond);
      b.at = t;
      buckets.set(key, b);
      if (b.tokens < 1) return false;
      b.tokens -= 1;
      return true;
    },
  };
}
