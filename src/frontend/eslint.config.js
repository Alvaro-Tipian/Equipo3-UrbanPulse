import js from "@eslint/js";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";

export default [
  js.configs.recommended,
  {
    files: ["**/*.jsx", "**/*.js"],
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: "module",
      },
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        URL: "readonly",
        fetch: "readonly",
        FormData: "readonly",
        navigator: "readonly",
        FileReader: "readonly",
        localStorage: "readonly",
        test: "readonly",
        expect: "readonly"
      }
    },
    settings: {
      react: { version: "detect" }
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "no-unused-vars": "error"
    }
  },
  {
    files: ["**/__tests__/**/*.jsx", "**/__tests__/**/*.js", "**/*.test.jsx", "**/*.test.js"],
    languageOptions: {
      globals: {
        describe: "readonly",
        it: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        jest: "readonly",
        Storage: "readonly"
      }
    }
  }
];