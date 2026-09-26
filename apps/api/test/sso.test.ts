import { afterAll, describe, expect, it } from "vitest";
import { freeUsername } from "../src/auth.js";
import { loadConfig, ssoConfig } from "../src/config.js";
import { makeApp, signUp, uniqueName } from "./helpers.js";

// Adresse jamais jointe : la découverte échoue, le fournisseur est ignoré, mais le mode reste « sso ».
const SSO_ENV = {
  AUTHENTIK_ISSUER: "http://127.0.0.1:9/application/o/palacards/",
  AUTHENTIK_CLIENT_ID: "palacards-test",
  AUTHENTIK_CLIENT_SECRET: "secret-de-test",
};

const password = await makeApp();
const sso = await makeApp({}, SSO_ENV);
afterAll(async () => {
  await password.app.close();
  await sso.app.close();
});

describe("connexion unique Authentik : configuration", () => {
  it("exige l'émetteur, l'identifiant et le secret ensemble", () => {
    expect(() => loadConfig({ AUTHENTIK_ISSUER: SSO_ENV.AUTHENTIK_ISSUER })).toThrow(/vont ensemble/);
    expect(ssoConfig(loadConfig({}))).toBeNull();
  });

  it("déduit la page « Mon compte » d'Authentik", () => {
    const conf = ssoConfig(
      loadConfig({ ...SSO_ENV, AUTHENTIK_ISSUER: "https://auth.palawi.fr/application/o/palacards" }),
    );
    expect(conf?.issuer).toBe("https://auth.palawi.fr/application/o/palacards/");
    expect(conf?.accountUrl).toBe("https://auth.palawi.fr/if/user/#/settings");
  });
});

describe("connexion unique Authentik : API", () => {
  it("annonce le mode de connexion au web", async () => {
    const off = await password.app.inject({ method: "GET", url: "/palacards/api/config" });
    expect(off.json().auth).toEqual({ mode: "password" });
    const on = await sso.app.inject({ method: "GET", url: "/palacards/api/config" });
    expect(on.json().auth).toMatchObject({ mode: "sso", provider: "authentik" });
  });

  it("coupe l'inscription et la connexion par mot de passe", async () => {
    const headers = { origin: "http://localhost:3000" };
    const signUpRes = await sso.app.inject({
      method: "POST",
      url: "/palacards/api/auth/sign-up/email",
      headers,
      payload: { username: uniqueName("sso"), password: "motdepasse123" },
    });
    expect(signUpRes.statusCode).toBe(404);
    const signInRes = await sso.app.inject({
      method: "POST",
      url: "/palacards/api/auth/sign-in/username",
      headers,
      payload: { username: "palawi", password: "motdepasse123" },
    });
    expect(signInRes.statusCode).toBe(404);
  });

  it("choisit un pseudo libre à partir du nom Authentik", async () => {
    const taken = await signUp(password.app, uniqueName("Pris"));
    const fresh = await freeUsername(password.ctx.db, taken.username.toUpperCase());
    expect(fresh.toLowerCase()).not.toBe(taken.username.toLowerCase());
    expect(fresh).toMatch(/^[a-zA-Z0-9_.]{3,20}$/);
    expect(await freeUsername(password.ctx.db, "a b@c!")).toBe("abc");
    expect(await freeUsername(password.ctx.db, "")).toMatch(/^joueur/);
  });
});
