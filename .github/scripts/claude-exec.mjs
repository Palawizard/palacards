// Lit le journal d'exécution de claude-code-action (sortie `execution_file`) :
//   node .github/scripts/claude-exec.mjs <fichier>
// Affiche un résumé dans le journal du run (fin du dernier message de Claude, outils refusés) pour comprendre un
// échec sans publier tout le transcript (dépôt public), et écrit la sortie `limit=true|false` : limite du forfait
// Claude ou API saturée, qui n'est pas un échec de la suggestion.
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const file = process.argv[2];
let limit = false;
if (file && existsSync(file)) {
  let entries = [];
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    entries = Array.isArray(data) ? data : [];
  } catch {
    console.log("Journal de Claude illisible.");
  }
  const result = entries.filter((e) => e?.type === "result").at(-1);
  const text = typeof result?.result === "string" ? result.result : "";
  limit = /usage limit|hit your (usage )?limit|limit reached|rate.?limit|overloaded/i.test(text);
  console.log(
    `Claude : ${result?.subtype ?? "pas de résultat"}, ${result?.num_turns ?? "?"} tours, erreur : ${result?.is_error ?? "?"}`,
  );
  const denials = Array.isArray(result?.permission_denials) ? result.permission_denials : [];
  if (denials.length) {
    console.log(`Outils refusés (${denials.length}) :`);
    for (const d of denials.slice(0, 20)) {
      const input = d?.tool_input?.command ?? d?.tool_input?.file_path ?? JSON.stringify(d?.tool_input ?? {});
      console.log(`  - ${d?.tool_name ?? "?"} : ${String(input).replace(/\s+/g, " ").slice(0, 200)}`);
    }
  }
  if (text) console.log(`Dernier message de Claude (fin) :\n${text.slice(-1500)}`);
} else {
  console.log("Pas de journal de Claude (l'étape n'a pas tourné ou a échoué avant).");
}
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `limit=${limit}\n`);
