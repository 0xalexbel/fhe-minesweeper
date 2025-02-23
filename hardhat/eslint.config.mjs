import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  {
    languageOptions: {
      globals: globals.node,
    },
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["coverage/", ".abi/", ".artifacts/", ".cache/", ".coverage/", ".res/", ".types/"],
  }
];
