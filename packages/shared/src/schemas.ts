import { z } from "zod";

/** Pseudo : 3 à 20 caractères, lettres, chiffres, _ et -. */
export const usernameSchema = z
  .string()
  .trim()
  .min(3, "3 caractères minimum")
  .max(20, "20 caractères maximum")
  .regex(/^[a-zA-Z0-9_-]+$/, "Lettres, chiffres, _ et - uniquement");

export const passwordSchema = z.string().min(8, "8 caractères minimum").max(128);
