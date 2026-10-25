import { mkdtemp, readdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThumbCache } from "../src/services/thumb-cache.js";
import { makeApp, signUp } from "./helpers.js";

const dirs: string[] = [];
async function tempDir() {
  const d = await mkdtemp(join(tmpdir(), "thumbs-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function countFiles(dir: string) {
  let n = 0;
  for (const sub of await readdir(dir)) n += (await readdir(join(dir, sub))).length;
  return n;
}

describe("cache disque des vignettes", () => {
  it("rend l'image et son type après le premier téléchargement", async () => {
    const cache = new ThumbCache(await tempDir(), 1024 * 1024);
    const url = "https://upload.wikimedia.org/a/b/c.jpg";
    expect(await cache.get(url)).toBeNull();
    await cache.put(url, "image/jpeg", Buffer.from([1, 2, 3, 10, 4]));
    const hit = await cache.get(url);
    expect(hit?.type).toBe("image/jpeg");
    expect([...hit!.body]).toEqual([1, 2, 3, 10, 4]);
    expect(await cache.get("https://upload.wikimedia.org/autre.jpg")).toBeNull();
  });

  it("au-delà du plafond, supprime les images les moins récemment lues", async () => {
    const dir = await tempDir();
    const cache = new ThumbCache(dir, 3_000);
    const img = Buffer.alloc(1_000, 7);
    await cache.put("https://upload.wikimedia.org/1.jpg", "image/jpeg", img);
    await cache.put("https://upload.wikimedia.org/2.jpg", "image/jpeg", img);
    // La 1 est la plus ancienne… mais elle vient d'être relue : c'est la 2 qui doit partir.
    const old = new Date(Date.now() - 60_000);
    for (const sub of await readdir(dir))
      for (const f of await readdir(join(dir, sub))) await utimes(join(dir, sub, f), old, old);
    expect(await cache.get("https://upload.wikimedia.org/1.jpg")).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    await cache.put("https://upload.wikimedia.org/3.jpg", "image/jpeg", img);
    expect(await countFiles(dir)).toBe(2);
    expect(await cache.get("https://upload.wikimedia.org/1.jpg")).not.toBeNull();
    expect(await cache.get("https://upload.wikimedia.org/2.jpg")).toBeNull();
    expect(await cache.get("https://upload.wikimedia.org/3.jpg")).not.toBeNull();
  });
});

describe("relais /thumb avec cache", () => {
  it("télécharge une vignette une seule fois, puis la sert depuis le disque", async () => {
    const { app } = await makeApp({}, { THUMB_CACHE_DIR: await tempDir() });
    try {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(
          async () => new Response(new Uint8Array([9, 8, 7]), { headers: { "content-type": "image/png" } }),
        );
      const p = await signUp(app);
      const u = encodeURIComponent("https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.png");
      const first = await app.inject({ url: `/palacards/api/thumb?u=${u}`, headers: { cookie: p.cookie } });
      expect(first.statusCode).toBe(200);
      expect(first.headers["x-thumb-cache"]).toBe("miss");
      await new Promise((r) => setTimeout(r, 50));
      const second = await app.inject({ url: `/palacards/api/thumb?u=${u}`, headers: { cookie: p.cookie } });
      expect(second.statusCode).toBe(200);
      expect(second.headers["x-thumb-cache"]).toBe("hit");
      expect(second.headers["content-type"]).toBe("image/png");
      expect([...second.rawPayload]).toEqual([9, 8, 7]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      fetchSpy.mockRestore();
    } finally {
      await app.close();
    }
  });
});
