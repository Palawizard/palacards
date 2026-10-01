import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/Shell";

export const metadata: Metadata = {
  title: "Confidentialité et mentions légales",
  description: "Données gardées par PalaCards, durées de conservation, export et suppression du compte.",
  alternates: { canonical: "/confidentialite" },
};

const CONTACT = "palawi.pro@gmail.com";
const UPDATED = "1er octobre 2026";
// Politique commune de palawi.fr : URL absolue, hors du basePath /palacards.
const COMMON_POLICY = "https://palawi.fr/confidentialite/";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="section-title">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

const DATA: { what: string; detail: string; kept: string }[] = [
  {
    what: "Compte",
    detail: "Pseudo, mot de passe (haché, jamais lisible), email si tu en donnes un, date d'inscription.",
    kept: "Jusqu'à la suppression du compte",
  },
  {
    what: "Connexion",
    detail: "Cookie de session, adresse IP et navigateur de chaque session.",
    kept: "30 jours au plus, puis purge chaque nuit",
  },
  {
    what: "Partie",
    detail:
      "Cartes, points wiki et leur historique, paquets, enchères, échanges, duels et réponses aux quiz, succès, classements par saison.",
    kept: "Jusqu'à la suppression du compte",
  },
  {
    what: "Social",
    detail: "Amis, guilde, messages privés et de guilde, liste de souhaits.",
    kept: "Jusqu'à la suppression du compte",
  },
  {
    what: "Profil",
    detail: "Avatar ou photo de profil que tu importes.",
    kept: "Jusqu'à ce que tu la retires ou supprimes ton compte",
  },
  { what: "Notifications", detail: "Alertes du jeu (enchère dépassée, défi reçu…).", kept: "6 mois" },
  {
    what: "Journaux techniques",
    detail: "Requêtes reçues par le serveur (adresse IP, page demandée, heure), pour le dépannage et la sécurité.",
    kept: "Écrasés automatiquement (quelques jours)",
  },
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-16 pt-6 sm:px-6">
      <Wordmark />
      <div>
        <h1 className="page-title">Confidentialité</h1>
        <p className="mt-3 text-sm text-faint">Dernière mise à jour : {UPDATED}</p>
      </div>

      <p className="max-w-prose">
        PalaCards est un jeu entre amis, sans publicité, sans mesure d&apos;audience et sans revente de données. Cette
        page explique quelles données le jeu garde, pourquoi, combien de temps, et comment exercer tes droits (RGPD).
      </p>
      <p className="max-w-prose">
        Elle complète la{" "}
        <a className="article-link" href={COMMON_POLICY}>
          politique de confidentialité commune de palawi.fr
        </a>
        , qui couvre ton compte palawi.fr et les autres services du site.
      </p>

      <Section title="Qui est responsable">
        <p className="max-w-prose">
          Le site est édité à titre personnel et non commercial par <strong>Palawi</strong>, qui est aussi responsable
          du traitement des données. Contact :{" "}
          <a className="article-link" href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>
          .
        </p>
      </Section>

      <Section title="Ce que le jeu garde">
        <ul className="divide-y divide-line rounded-xl border border-line bg-panel">
          {DATA.map((d) => (
            <li key={d.what} className="grid gap-x-4 gap-y-0.5 px-4 py-3 sm:grid-cols-[8rem_1fr_12rem]">
              <strong>{d.what}</strong>
              <span className="text-muted">{d.detail}</span>
              <span className="text-sm text-faint sm:text-right">{d.kept}</span>
            </li>
          ))}
        </ul>
        <p className="max-w-prose">
          Les sauvegardes de la base sont gardées 14 jours, et celles du serveur entier 3 mois au plus : une donnée
          supprimée en disparaît au plus tard 3 mois après. Si tu te connectes avec ton compte palawi.fr, le jeu reçoit
          seulement ton identifiant et ton pseudo ; ce compte-là se gère sur auth.palawi.fr, sous la même
          responsabilité, et se supprime depuis la page « Mon compte » d&apos;auth.palawi.fr.
        </p>
      </Section>

      <Section title="Pourquoi">
        <ul className="flex max-w-prose list-disc flex-col gap-1.5 pl-5">
          <li>
            <strong>Faire tourner le jeu</strong> (compte, collection, marché, échanges, duels, messages) : c&apos;est
            nécessaire au service que tu demandes en t&apos;inscrivant (exécution du contrat, art. 6.1.b du RGPD).
          </li>
          <li>
            <strong>Sécurité et équité</strong> (sessions, limitation des requêtes, journaux, sauvegardes) : intérêt
            légitime à protéger le jeu contre la triche, les abus et les pertes de données (art. 6.1.f).
          </li>
        </ul>
        <p className="max-w-prose">Aucune décision automatisée ni profilage à des fins commerciales.</p>
      </Section>

      <Section title="Qui les voit">
        <ul className="flex max-w-prose list-disc flex-col gap-1.5 pl-5">
          <li>
            <strong>Les autres joueurs</strong> voient ton pseudo, ton avatar, ton profil (collection, statistiques,
            succès), tes ventes au marché, les classements et les messages que tu leur envoies.
          </li>
          <li>
            <strong>Palawi</strong>, administrateur, a accès à la base pour faire tourner et dépanner le jeu.
          </li>
          <li>
            <strong>Cloudflare</strong> (Cloudflare, Inc.) achemine le trafic jusqu&apos;au serveur, comme sous-traitant
            technique : il voit passer ton adresse IP. Les transferts hors de l&apos;Union européenne sont encadrés par
            le Data Privacy Framework et les clauses contractuelles types de la Commission européenne.
          </li>
        </ul>
        <p className="max-w-prose">
          Les textes et images des cartes viennent de Wikipédia, mais c&apos;est le serveur du jeu qui les récupère :
          ton navigateur ne contacte jamais Wikimedia. Seuls les liens « Wikipédia » que tu choisis d&apos;ouvrir
          t&apos;y emmènent, sous leur propre politique de confidentialité.
        </p>
      </Section>

      <Section title="Cookies">
        <p className="max-w-prose">
          Un seul cookie : <code className="text-sm">palawi_palacards_session</code>, qui te garde connecté. Il est
          strictement nécessaire, donc exempté de consentement. Ton thème et le réglage du son sont enregistrés dans ton
          navigateur (stockage local) et ne quittent pas ton appareil. Aucun traceur publicitaire ou de mesure
          d&apos;audience : c&apos;est pour ça qu&apos;il n&apos;y a pas de bandeau cookies.
        </p>
      </Section>

      <Section title="Tes droits">
        <p className="max-w-prose">
          Tu peux accéder à tes données, les corriger, les effacer, les récupérer dans un format réutilisable,
          t&apos;opposer à un traitement ou en demander la limitation.
        </p>
        <ul className="flex max-w-prose list-disc flex-col gap-1.5 pl-5">
          <li>
            <strong>Télécharger tes données</strong> (fichier JSON) et <strong>supprimer ton compte</strong> : en un
            clic dans{" "}
            <Link className="article-link" href="/settings#donnees">
              Paramètres → Mes données
            </Link>
            . La suppression est immédiate et définitive. Avec un compte palawi.fr, tu es ensuite envoyé sur
            auth.palawi.fr pour supprimer aussi ce compte-là (tu confirmes avec ton mot de passe).
          </li>
          <li>
            <strong>Corriger</strong> ton pseudo ou ton avatar : dans les Paramètres. Pour le reste, écris à{" "}
            <a className="article-link" href={`mailto:${CONTACT}`}>
              {CONTACT}
            </a>{" "}
            ; réponse sous un mois.
          </li>
          <li>
            En cas de désaccord, tu peux saisir la CNIL :{" "}
            <a className="article-link" href="https://www.cnil.fr/fr/plaintes" target="_blank" rel="noreferrer">
              cnil.fr/fr/plaintes
            </a>
            .
          </li>
        </ul>
        <p className="max-w-prose">Si tu as moins de 15 ans, demande l&apos;accord d&apos;un parent avant de jouer.</p>
      </Section>

      <Section title="Sécurité">
        <p className="max-w-prose">
          Connexion chiffrée (HTTPS), mots de passe hachés, cookie de session inaccessible aux scripts, base de données
          jamais exposée sur Internet, sauvegardes hors de la machine du jeu.
        </p>
      </Section>

      <Section title="Mentions légales">
        <dl className="grid max-w-prose grid-cols-[minmax(auto,11rem)_1fr] gap-x-4 gap-y-2">
          <dt className="font-semibold">Éditeur et directeur de la publication</dt>
          <dd>
            Palawi, particulier, site personnel et non commercial. Contact :{" "}
            <a className="article-link" href={`mailto:${CONTACT}`}>
              {CONTACT}
            </a>
            .
          </dd>
          <dt className="font-semibold">Hébergement</dt>
          <dd>
            Serveur personnel de l&apos;éditeur, situé en France. Acheminement réseau : Cloudflare, Inc., 101 Townsend
            Street, San Francisco, CA 94107, États-Unis.
          </dd>
          <dt className="font-semibold">Contenus</dt>
          <dd>
            Textes et images des cartes issus de Wikipédia en français, sous licence{" "}
            <a
              className="article-link"
              href="https://creativecommons.org/licenses/by-sa/4.0/deed.fr"
              target="_blank"
              rel="noreferrer"
            >
              CC BY-SA
            </a>
            , crédités sur chaque carte. PalaCards n&apos;est pas affilié à la Wikimedia Foundation.
          </dd>
        </dl>
      </Section>
    </main>
  );
}
