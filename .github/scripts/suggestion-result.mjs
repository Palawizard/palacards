// Vérifie le travail de Claude sur une branche de suggestion, puis prépare la pull request et le compte rendu.
//   node .github/scripts/suggestion-result.mjs <numéro de suggestion> <numéro d'issue> <branche>
// Écrit .automation/pr.md (description de la PR), .automation/report.json (compte rendu pour l'API)
// et les sorties `title` et `questions` du step. Code de sortie 1 : branche refusée (rien n'est poussé) ; la raison
// est alors dans .automation/failure.txt et la sortie `repairable` dit si Claude peut la corriger (pas un refus).
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const [suggestion, issue, branch] = process.argv.slice(2);
const fail = (message, repairable = true) => {
  console.error(`::error::${message}`);
  writeFileSync(".automation/failure.txt", `${message}\n`);
  writeFileSync(".automation/report.json", JSON.stringify({ status: "failed", error: message.slice(0, 300) }));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `repairable=${repairable}\n`);
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
  fail(
    `Claude n'a pas construit la branche : ${String(r.blockedReason ?? "raison non précisée").slice(0, 500)}`,
    false,
  );
if (r.status !== "ready") fail(`statut inattendu : ${r.status}`);
if (!str(r.title, 100) || !/^(feat|fix)(\([^)]+\))?: /.test(r.title))
  fail("titre manquant ou hors convention (feat: …)");
if (!str(r.summary, 2000)) fail("résumé manquant");
if (!str(r.playerReply, 1000)) fail("réponse au joueur manquante");
const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).slice(0, 30) : []);
const clip = (v, max) =>
  String(v ?? "")
    .trim()
    .slice(0, max);

/**
 * Points à trancher par Palawi : chaque question, ses options et l'option recommandée, déjà codée.
 * Format attendu : `choices: [{ question, options, recommended }]`. Les anciens `decisions`
 * ({ question, choice, alternatives }) et `questions` (texte libre) sont repris dans le même format.
 */
function readChoices(res) {
  const out = [];
  for (const c of Array.isArray(res.choices) ? res.choices : []) {
    const options = list(c?.options).map((o) => clip(o, 200));
    const recommended = clip(c?.recommended, 200);
    if (!clip(c?.question, 1) || !recommended) continue;
    out.push({
      question: clip(c.question, 300),
      options: options.includes(recommended) ? options : [recommended, ...options],
      recommended,
    });
  }
  for (const d of Array.isArray(res.decisions) ? res.decisions : []) {
    const recommended = clip(d?.choice, 200);
    if (!clip(d?.question, 1) || !recommended) continue;
    out.push({
      question: clip(d.question, 300),
      options: [recommended, ...list(d.alternatives).map((o) => clip(o, 200))],
      recommended,
    });
  }
  for (const q of list(res.questions)) out.push({ question: clip(q, 300), options: [], recommended: "" });
  return out.slice(0, 12);
}
const choices = readChoices(r);

// claude-code-action remet la configuration de Claude de la branche par défaut (.claude, CLAUDE.md…) dans l'arbre
// de travail : ce ne sont pas des changements de Claude, on revient à la branche avant de vérifier.
for (const p of [
  ".claude",
  ".mcp.json",
  ".claude.json",
  ".gitmodules",
  ".ripgreprc",
  "CLAUDE.md",
  "CLAUDE.local.md",
  ".husky",
]) {
  try {
    execFileSync("git", ["checkout", "-q", "HEAD", "--", p], { stdio: "ignore" });
  } catch {
    // Chemin absent de la branche.
  }
}

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
if (choices.length) {
  // Exemple de réponse : la première autre option disponible.
  const withAlt = choices.findIndex((c) => c.options.some((o) => o !== c.recommended));
  const example =
    withAlt === -1
      ? "@claude 1 : …"
      : `@claude ${withAlt + 1} : ${choices[withAlt].options.find((o) => o !== choices[withAlt].recommended)}`;
  sections.push(
    [
      "## À trancher",
      "",
      `Chaque point est **déjà codé avec l'option recommandée** (✅). Si elle te va, rien à faire : merge la PR. Pour en changer, réponds en commentaire, par exemple \`${example}\`.`,
      ...choices.map((c, i) =>
        [
          "",
          `### ${i + 1}. ${c.question}`,
          "",
          ...(c.options.length
            ? c.options.map((o) => (o === c.recommended ? `- ✅ **${o}** (recommandé, déjà codé)` : `- ${o}`))
            : ["- Question ouverte : réponds en commentaire avec `@claude`."]),
        ].join("\n"),
      ),
    ].join("\n"),
  );
}
if (list(r.changes).length) sections.push(`## Changements\n\n${bullets(list(r.changes))}`);
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
    openQuestions: choices.length,
  }),
);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `title=${r.title.trim().replace(/[\r\n]/g, " ")} (suggestion n° ${suggestion})\n`,
  );
  appendFileSync(process.env.GITHUB_OUTPUT, `questions=${choices.length}\n`);
}
console.log(
  `Branche ${branch} : ${commits} commit(s), ${changed.length} fichier(s), ${choices.length} point(s) à trancher.`,
);
