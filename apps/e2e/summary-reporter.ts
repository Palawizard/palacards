import { appendFileSync } from "node:fs";
import type { FullResult, Reporter, TestCase, TestError, TestResult } from "@playwright/test/reporter";

// En CI (GitHub Actions), écrit les échecs dans le résumé du run : lisible sans télécharger l'artefact.
// eslint-disable-next-line no-control-regex -- codes couleur ANSI des messages Playwright
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

export default class SummaryReporter implements Reporter {
  private failures: string[] = [];
  private errors: string[] = [];

  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status === "passed" || result.status === "skipped") return;
    const where = test.location ? `${test.location.file.split(/[\\/]/).slice(-1)[0]}:${test.location.line}` : "";
    const message = result.errors.map((e) => strip(e.message ?? e.value ?? "")).join("\n\n");
    this.failures.push(
      `#### ✘ ${test.titlePath().slice(1).join(" › ")} (${where}, ${result.status}, essai ${result.retry + 1})\n\n\`\`\`\n${message.slice(0, 4000)}\n\`\`\``,
    );
  }

  onError(error: TestError) {
    this.errors.push(`\`\`\`\n${strip(error.message ?? error.value ?? String(error)).slice(0, 4000)}\n\`\`\``);
  }

  onEnd(result: FullResult) {
    const file = process.env.GITHUB_STEP_SUMMARY;
    if (!file || (result.status === "passed" && this.errors.length === 0)) return;
    const parts = [`### E2E : ${result.status}`];
    if (this.errors.length) parts.push("**Erreurs globales (serveurs, configuration)**", ...this.errors);
    if (this.failures.length) parts.push(`**${this.failures.length} test(s) en échec**`, ...this.failures);
    appendFileSync(file, parts.join("\n\n") + "\n");
  }
}
