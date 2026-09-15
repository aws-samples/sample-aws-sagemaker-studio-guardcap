import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// Replaces eslint-config-next, which came with the framework and went with it.
// Deliberately close to what that config actually enforced here: TypeScript
// correctness plus the react-hooks rules, which are the ones that catch real
// bugs in this codebase - a missing dependency in AuthProvider's effect is a
// stale token, not a style question.
export default defineConfig([
  globalIgnores(["dist/**", "node_modules/**"]),
  {
    files: ["**/*.{ts,tsx,mts}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    },
    rules: {
      // The rule already skips plain strings; template literals are the same
      // kind of content. A non-breaking space in user-facing text is deliberate
      // - see the threshold label in BudgetOverview, which relies on one to keep
      // a comparison and its number on the same line.
      "no-irregular-whitespace": ["error", { skipTemplates: true }],
    },
  },
  // The `flat` namespace, not the top-level `configs.recommended-latest`: that
  // one is still the eslintrc shape, whose `plugins: ["react-hooks"]` array flat
  // config rejects outright. This one carries the plugin object with it.
  reactHooks.configs.flat["recommended-latest"],
  {
    // vite.config.ts runs in Node, not the browser.
    files: ["vite.config.ts"],
    languageOptions: { globals: globals.node },
  },
]);
