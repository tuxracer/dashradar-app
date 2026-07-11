import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

// No jsx-a11y: accessibility lint is intentionally off — see CLAUDE.md
// ("No accessibility (a11y) lint" under Coding Standards).
const eslintConfig = defineConfig([
  globalIgnores(["dist/**"]),
  js.configs.recommended,
  tseslint.configs.recommended,
  react.configs.flat.recommended,
  reactHooks.configs.flat["recommended-latest"],
  {
    plugins: { "react-refresh": reactRefresh },
    languageOptions: { globals: { ...globals.browser } },
    settings: { react: { version: "detect" } },
    rules: {
      // React 19 + TypeScript: no React import needed for JSX, types replace PropTypes.
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    // The repo's module convention (`export * from "./consts"` — see CLAUDE.md)
    // is invisible to react-refresh's export analysis and would warn on every
    // feature component forever. Keep the rule for entry/top-level files only.
    files: ["src/components/**", "src/context/**"],
    rules: { "react-refresh/only-export-components": "off" },
  },
]);

export default eslintConfig;
