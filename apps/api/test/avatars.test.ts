import { avatarImage } from "@palacards/shared";
import { afterAll, describe, expect, it } from "vitest";
import { sniffImage } from "../src/services/avatars.js";
import { makeApp, signUp } from "./helpers.js";

const { app } = await makeApp();
afterAll(() => app.close());

// Images de 40 × 30 px produites par Pillow.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAALklEQVR4nO3NMQEAMAgAoLk0ZjKxsazg5wMFiM56F/7JKhaLxWKxWCwWi8XilQH91QGGD5y0UgAAAABJRU5ErkJggg==";
const WEBP_LOSSY =
  "UklGRkIAAABXRUJQVlA4IDYAAAAQAwCdASooAB4APm02l0ikIyIhJWgAgA2JZwAALKXNOAAA/u4KHn//+wd//5wH//OA/ooAAAA=";
const WEBP_LOSSLESS = "UklGRh4AAABXRUJQVlA4TBEAAAAvJ0AHAAdQlCJXq/+BiOh/AAA=";
const JPEG =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAeACgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDkqKKKk/VwooooAKKKKACiiigAooooAKKKKAP/2Q==";

const b = (s: string) => Buffer.from(s, "base64");

describe("reconnaissance des images", () => {
  it("lit le type et les dimensions d'après les octets", () => {
    expect(sniffImage(b(PNG))).toEqual({ mime: "image/png", width: 40, height: 30 });
    expect(sniffImage(b(JPEG))).toEqual({ mime: "image/jpeg", width: 40, height: 30 });
    expect(sniffImage(b(WEBP_LOSSY))).toEqual({ mime: "image/webp", width: 40, height: 30 });
    expect(sniffImage(b(WEBP_LOSSLESS))).toEqual({ mime: "image/webp", width: 40, height: 30 });
  });

  it("refuse ce qui n'est pas une image connue", () => {
    expect(sniffImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"))).toBe(
      null,
    );
    expect(sniffImage(Buffer.from("GIF89a" + "x".repeat(40)))).toBe(null);
    expect(sniffImage(b(PNG).subarray(0, 20))).toBe(null);
  });
});

describe("photo de profil", () => {
  it("importe, sert, remplace puis retire la photo", async () => {
    const p = await signUp(app);
    const up = await p.put("/me/avatar", { image: PNG });
    expect(up.status).toBe(200);
    const ref = avatarImage(up.body.avatar);
    expect(ref?.userId).toBe(p.userId);

    const img = await app.inject({
      url: `/palacards/api/avatars/${p.userId}?v=${ref!.version}`,
      headers: { cookie: p.cookie },
    });
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
    expect(img.headers["x-content-type-options"]).toBe("nosniff");
    expect(img.headers["cache-control"]).toMatch(/immutable/);
    expect(img.rawPayload.equals(b(PNG))).toBe(true);

    // Un autre joueur connecté voit la photo ; sans session, non.
    const other = await signUp(app);
    const seen = await app.inject({ url: `/palacards/api/avatars/${p.userId}`, headers: { cookie: other.cookie } });
    expect(seen.statusCode).toBe(200);
    expect((await app.inject({ url: `/palacards/api/avatars/${p.userId}` })).statusCode).toBe(401);

    // Nouvelle photo : nouvelle version (le cache du navigateur ne ressert pas l'ancienne).
    const again = await p.put("/me/avatar", { image: WEBP_LOSSY });
    expect(again.body.avatar).not.toBe(up.body.avatar);

    // Choisir un emoji efface la photo.
    const emoji = await app.inject({
      method: "PATCH",
      url: "/palacards/api/me/settings",
      headers: { cookie: p.cookie, origin: "http://localhost:3000" },
      payload: { avatar: "🦉" },
    });
    expect(emoji.json().avatar).toBe("🦉");
    expect(
      (await app.inject({ url: `/palacards/api/avatars/${p.userId}`, headers: { cookie: p.cookie } })).statusCode,
    ).toBe(404);

    await p.put("/me/avatar", { image: JPEG });
    const removed = await app.inject({
      method: "DELETE",
      url: "/palacards/api/me/avatar",
      headers: { cookie: p.cookie, origin: "http://localhost:3000" },
    });
    expect(removed.json().avatar).toBe(null);
  });

  it("refuse une image déguisée, trop lourde ou une référence forgée", async () => {
    const p = await signUp(app);
    const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>".padEnd(64, " ")).toString("base64");
    expect((await p.put("/me/avatar", { image: svg })).body.error).toBe("avatar_format");
    expect((await p.put("/me/avatar", { image: "pas du base64 !" })).status).toBe(400);
    const heavy = Buffer.concat([b(PNG), Buffer.alloc(151_000)]).toString("base64");
    expect((await p.put("/me/avatar", { image: heavy })).status).toBe(400);

    // `img:` ne passe que par l'import : impossible de pointer sur la photo d'un autre.
    const forged = await app.inject({
      method: "PATCH",
      url: "/palacards/api/me/settings",
      headers: { cookie: p.cookie, origin: "http://localhost:3000" },
      payload: { avatar: "img:quelquun.abc" },
    });
    expect(forged.statusCode).toBe(400);
  });
});
