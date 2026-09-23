import { z } from "zod";

const schema = z.object({
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  BASE_PATH: z
    .string()
    .default("/palacards")
    .refine(
      (v) => v === "" || (v.startsWith("/") && !v.endsWith("/")),
      "BASE_PATH doit commencer par / et ne pas finir par /",
    ),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}
