import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

// Deliberately small: only rules that catch real bugs, no style. Formatting
// and naming are not linted (see CLAUDE.md). Repo-specific rules live in
// scripts/check-rules.mjs.
export default tseslint.config(
  { ignores: ["dist", "node_modules", "supabase/functions", "evals", ".claude", "design", "docs", "presentation"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [tseslint.configs.base],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-debugger": "error",
      "no-dupe-keys": "error",
      "no-self-assign": "error",
      "no-unreachable": "error",
      "no-constant-binary-expression": "error",
      "no-unsafe-finally": "error",
      "no-dupe-else-if": "error",
      "no-duplicate-case": "error",
    },
  },
);
