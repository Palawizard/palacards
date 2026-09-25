// Config ESLint des packages Node (api, db, game, shared, e2e). Le front a la sienne (apps/web).
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "**/dist/**",
    "**/.next/**",
    "**/node_modules/**",
    "apps/web/**",
    "tools/**",
    "**/playwright-report/**",
    "**/test-results/**",
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": "off",
    },
  },
]);
