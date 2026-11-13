// ESLint flat config (E2 done-when: lint passes clean). TypeScript is already
// checked by `tsc -b`; lint adds the rules tsc cannot see — hook dependency
// correctness (react-hooks/exhaustive-deps) and accessibility intent
// (jsx-a11y). Type-aware linting is intentionally not enabled: it needs a
// project graph and buys little on top of the strict tsc config.
//
// The react-hooks v7 plugin also ships the React Compiler's advisory purity
// rules (refs / set-state-in-effect / purity). They are disabled here with
// intent, because Folio's architecture deliberately uses the patterns they
// flag — see the comments inline.
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import globals from "globals";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "src-tauri/", "coverage/"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat["recommended-latest"],
  jsxA11y.flatConfigs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { react },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: "detect" } },
    rules: {
      // Folio code style keeps the tree readable without forcing rewrites.
      "react/react-in-jsx-scope": "off",
      "react/jsx-uses-react": "off",
      "react/prop-types": "off",

      // --- react-hooks v7 compiler-purity advisories (off with intent) ---
      // refs: Folio uses two documented ref patterns the rule rejects —
      //   (1) lazy singletons (`if (!ref.current) ref.current = new State()`)
      //   (2) latest-callback refs (`onCloseRef.current = onClose`) that keep
      //   long-lived effect closures from acting on stale props (07 §3).
      // Both are render-time ref *writes* of implementation detail, never of
      // render output; the P0-2 focus-stability tests pin the behaviour.
      "react-hooks/refs": "off",
      // set-state-in-effect: several effects intentionally synchronise
      // external state into React (doc load → splash/prefs, debounced search
      // results, collection/notes lists). Each runs on identity changes, not
      // every render, so no cascade loop exists.
      "react-hooks/set-state-in-effect": "off",
      // purity: `Date.now()` seeds session timing and pace-derived labels that
      // are refreshed through `paceVersion`; nothing renderable is derived
      // from the impurity itself.
      "react-hooks/purity": "off",

      // --- typescript-eslint strictness matched to the existing code style ---
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // jsx-a11y/no-autofocus: every use is inside a modal dialog or the in-book
    // search popover, where focusing the primary field on open is the
    // documented behaviour (P0-2, tests/focusStability.test.tsx). The rule's
    // usability concern targets pages, not modals.
    files: ["**/*.tsx"],
    rules: { "jsx-a11y/no-autofocus": "off" },
  },
  {
    files: ["scripts/**/*.{mjs,ts}", "tests/**/*.{ts,tsx}", "*.config.js"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // Tests exercise failure paths with deliberate misuse.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  prettier,
);
