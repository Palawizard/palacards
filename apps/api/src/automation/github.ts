/** Création d'issues sur le dépôt public (jeton GitHub limité aux issues de ce dépôt). */
export interface GithubConfig {
  repository: string;
  token: string;
}

export async function createIssue(
  gh: GithubConfig,
  issue: { title: string; body: string; labels: string[] },
): Promise<{ number: number; url: string }> {
  const res = await fetch(`https://api.github.com/repos/${gh.repository}/issues`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${gh.token}`,
      "content-type": "application/json",
      "user-agent": "palacards-automation",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify(issue),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`GitHub : HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { number: number; html_url: string };
  return { number: json.number, url: json.html_url };
}

/** État d'une pull request (dépôt public : lisible avec le jeton des issues). */
export async function pullState(gh: GithubConfig, n: number): Promise<"open" | "merged" | "closed"> {
  const res = await fetch(`https://api.github.com/repos/${gh.repository}/pulls/${n}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${gh.token}`,
      "user-agent": "palacards-automation",
      "x-github-api-version": "2022-11-28",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`GitHub : HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { state: string; merged?: boolean; merged_at?: string | null };
  if (json.state === "open") return "open";
  return json.merged || json.merged_at ? "merged" : "closed";
}

export const issueUrl = (repository: string, n: number) => `https://github.com/${repository}/issues/${n}`;
export const pullUrl = (repository: string, n: number) => `https://github.com/${repository}/pull/${n}`;
