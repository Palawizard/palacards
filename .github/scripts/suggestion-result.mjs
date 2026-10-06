// Vérifie le travail de Claude sur une branche de suggestion, puis prépare la pull request et le compte rendu.
//   node .github/scripts/suggestion-result.mjs <numéro de suggestion> <numéro d'issue> <branche>
// Écrit .automation/pr.md (description de la PR), .automation/report.json (compte rendu pour l'API)
// et les sorties `title` et `questions` du step. Code de sortie 1 : branche refusée (rien n'est poussé).
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const [suggestion, issue, branch] = process.argv.slice(2);
const fail = (message) => {
  console.error(`::error::${message}`);
  writeFileSync(".automation/report.json", JSON.stringify({ status: "failed" }));
  process.exit(1);
};
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const str = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max;

if (!existsSync(".automation/result.json")) fail("Claude n'a pas écrit .automation/result.json");
let r;
try {
  r = JSON.parse(readFileSync(".automation/result.json", "utf8"));
} catch {
  fail(".automation/result.json n'est pas du JSON valide");
}
if (r.status === "blocked")
  fail(`Claude n'a pas construit la branche : ${String(r.blockedReason ?? "raison non précisée").slice(0, 500)}`);
if (r.status !== "ready") fail(`statut inattendu : ${r.status}`);
if (!str(r.title, 100) || !/^(feat|fix)(\([^)]+\))?: /.test(r.title))
  fail("titre manquant ou hors convention (feat: …)");
if (!str(r.summary, 2000)) fail("résumé manquant");
if (!str(r.playerReply, 1000)) fail("réponse au joueur manquante");
const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).slice(0, 30) : []);
const decisions = Array.isArray(r.decisions) ? r.decisions.slice(0, 10) : [];
const questions = list(r.questions);

// Au moins un commit, et rien dans les fichiers d'infrastructure.
const commits = Number(git("rev-list", "--count", "origin/dev..HEAD"));
if (commits === 0) fail("aucun commit sur la branche");
if (git("status", "--porcelain", "--untracked-files=no")) fail("des modifications ne sont pas commitées");
const changed = git("diff", "--name-only", "origin/dev...HEAD").split("\n").filter(Boolean);
const forbidden = changed.filter((f) =>
  /^(\.github\/|deploy\/|docker\/|\.githooks\/|docker-compose[^/]*\.ya?ml$|\.env|\.claude\/settings)/.test(f),
);
if (forbidden.length) fail(`fichiers interdits modifiés : ${forbidden.join(", ")}`);
const migrations = changed.filter((f) => f.startsWith("packages/db/migrations/") && f.endsWith(".sql"));

const quote = (t) =>
  String(t)
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
const bullets = (items) => items.map((x) => `- ${x}`).join("\n");
const sections = [
  `Suggestion n° ${suggestion} · issue #${issue} · branche \`${branch}\``,
  `## Résumé\n\n${r.summary.trim()}`,
];
if (list(r.changes).length) sections.push(`## Changements\n\n${bullets(list(r.changes))}`);
if (decisions.length)
  sections.push(
    `## Choix provisoires\n\n${decisions
      .map(
        (d, i) =>
          `${i + 1}. **${String(d.question ?? "").slice(0, 300)}**\n   Choix : ${String(d.choice ?? "").slice(0, 300)}${
            Array.isArray(d.alternatives) && d.alternatives.length
              ? `\n   Autres options : ${d.alternatives.map(String).join(" · ").slice(0, 400)}`
              : ""
          }`,
      )
      .join("\n")}`,
  );
if (questions.length)
  sections.push(
    `## Questions pour Palawi\n\n${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\nRéponds en commentaire en commençant par \`@claude\` (par exemple « @claude question 1 : option B »).`,
  );
if (migrations.length) sections.push(`## Migration\n\n${bullets(migrations.map((m) => `\`${m}\``))}`);
sections.push(`## Réponse proposée au joueur\n\n${quote(r.playerReply.trim())}`);
if (str(r.announcement, 500)) sections.push(`## Ligne d'annonce\n\n${quote(r.announcement.trim())}`);
if (list(r.checks).length) sections.push(`## Vérifications\n\n${bullets(list(r.checks))}`);
sections.push(
  "---\nBranche préparée automatiquement. Pour l'accepter : **Squash and merge** vers `dev` (le commit sera à ton nom). Pour demander une modification : un commentaire qui commence par `@claude`.",
);
writeFileSync(".automation/pr.md", sections.join("\n\n"));
writeFileSync(
  ".automation/report.json",
  JSON.stringify({
    status: "ready",
    title: r.title.trim(),
    playerReply: r.playerReply.trim().slice(0, 1000),
    ...(str(r.announcement, 500) ? { announcement: r.announcement.trim() } : {}),
    openQuestions: questions.length,
  }),
);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `title=${r.title.trim().replace(/[\r\n]/g, " ")} (suggestion n° ${suggestion})\n`,
  );
  appendFileSync(process.env.GITHUB_OUTPUT, `questions=${questions.length}\n`);
}
console.log(`Branche ${branch} : ${commits} commit(s), ${changed.length} fichier(s), ${questions.length} question(s).`);
