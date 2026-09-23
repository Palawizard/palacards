import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const { app } = await buildApp(config, { jobs: true });

const shutdown = async (signal: string) => {
  app.log.info(`${signal} reçu, arrêt…`);
  await app.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.API_HOST, port: config.API_PORT });
app.log.info(`API prête sur http://localhost:${config.API_PORT}${config.BASE_PATH}/api/health`);
