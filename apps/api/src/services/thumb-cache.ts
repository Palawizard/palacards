import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Cache disque des vignettes Wikimedia relayées par /thumb : chaque image n'est téléchargée qu'une fois, puis lue
 * sur le disque (avant, chaque affichage d'une carte refaisait l'aller-retour vers Wikimedia).
 *
 * Un fichier par adresse (nom = SHA-256 de l'adresse, rangé par ses 2 premiers caractères) : première ligne le
 * type MIME, puis l'image. Au-delà du plafond, les images les moins récemment lues sont supprimées jusqu'à 80 %
 * du plafond (la date de modification est remise à jour à chaque lecture). Tout échec de lecture ou d'écriture
 * retombe sur Wikimedia : le cache n'est jamais bloquant.
 */
export class ThumbCache {
  /** Taille occupée en octets ; -1 tant que le dossier n'a pas été parcouru. */
  private size = -1;
  private pruning: Promise<void> | null = null;

  constructor(
    private readonly dir: string,
    private readonly maxBytes: number,
  ) {}

  private path(url: string) {
    const h = createHash("sha256").update(url).digest("hex");
    return join(this.dir, h.slice(0, 2), h);
  }

  async get(url: string): Promise<{ type: string; body: Buffer } | null> {
    const p = this.path(url);
    let buf: Buffer;
    try {
      buf = await readFile(p);
    } catch {
      return null;
    }
    const nl = buf.indexOf(10);
    if (nl <= 0 || nl > 100) return null;
    const now = new Date();
    void utimes(p, now, now).catch(() => {});
    return { type: buf.subarray(0, nl).toString("latin1"), body: buf.subarray(nl + 1) };
  }

  async put(url: string, type: string, body: Buffer): Promise<void> {
    const p = this.path(url);
    const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
    try {
      await mkdir(dirname(p), { recursive: true });
      const data = Buffer.concat([Buffer.from(`${type}\n`, "latin1"), body]);
      await writeFile(tmp, data);
      await rename(tmp, p);
      if (this.size >= 0) this.size += data.length;
    } catch {
      await unlink(tmp).catch(() => {});
      return;
    }
    if (this.size < 0 || this.size > this.maxBytes) await this.prune();
  }

  /** Recalcule la taille du cache et, au-delà du plafond, supprime les images les moins récemment lues. */
  prune(): Promise<void> {
    this.pruning ??= this.doPrune().finally(() => {
      this.pruning = null;
    });
    return this.pruning;
  }

  private async doPrune() {
    const files: { p: string; size: number; t: number }[] = [];
    for (const sub of await readdir(this.dir).catch(() => [] as string[])) {
      for (const f of await readdir(join(this.dir, sub)).catch(() => [] as string[])) {
        const p = join(this.dir, sub, f);
        try {
          const s = await stat(p);
          if (s.isFile()) files.push({ p, size: s.size, t: s.mtimeMs });
        } catch {
          // supprimé entre-temps
        }
      }
    }
    let total = files.reduce((n, f) => n + f.size, 0);
    if (total > this.maxBytes) {
      files.sort((a, b) => a.t - b.t);
      for (const f of files) {
        if (total <= this.maxBytes * 0.8) break;
        try {
          await unlink(f.p);
          total -= f.size;
        } catch {
          // déjà supprimé
        }
      }
    }
    this.size = total;
  }
}
