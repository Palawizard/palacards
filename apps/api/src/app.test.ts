import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

describe("API", async () => {
  const { app } = await buildApp(loadConfig({ BASE_PATH: "/palacards" }));
  afterAll(() => app.close());

  it("répond sur /palacards/api/health sans base configurée", async () => {
    const res = await app.inject({ method: "GET", url: "/palacards/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", database: "not_configured" });
  });

  it("n'expose rien hors du sous-chemin", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(404);
  });
});
