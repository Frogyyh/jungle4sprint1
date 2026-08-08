/* Breachline — ESLint flat config (무관용 원칙)
 * game.js 는 three.js + 미니파이드 코어 번들이므로 제외한다. */
const globals = require("globals");
const js = require("@eslint/js");

const sharedRules = {
  "no-unused-vars": ["error", {
    args: "after-used",
    ignoreRestSiblings: true,
    caughtErrors: "all",
  }],
  "prefer-const": "error",
  "no-var": "error",
  eqeqeq: ["error", "smart"],
  "no-useless-escape": "error",
  "no-unused-expressions": "error",
  "default-case-last": "error",
  "default-param-last": "error",
  "no-else-return": "error",
  "no-lonely-if": "error",
  "no-prototype-builtins": "error",
  "no-array-constructor": "error",
  "no-new-wrappers": "error",
  "no-eval": "error",
  "no-implied-eval": "error",
  "no-alert": "off",
  "no-constant-condition": ["error", { checkLoops: false }],
};

module.exports = [
  {
    ignores: [
      "game.js",
      "node_modules/**",
      "Backups/**",
      "Asset/**",
      "public/**",
      ".pnpm-store/**",
      ".wrangler/**",
    ],
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        DurableObject: "readonly",
        WebSocketPair: "readonly",
        WebSocketRequestResponsePair: "readonly",
        WebSocket: "readonly",
      },
    },
    rules: { ...js.configs.recommended.rules, ...sharedRules },
  },
  {
    files: ["eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: { ...js.configs.recommended.rules, ...sharedRules },
  },
  {
    // 일반 스크립트 (IIFE 글로벌 패치 방식)
    files: ["**/*.js", "!ui/**", "!eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    rules: { ...js.configs.recommended.rules, ...sharedRules },
  },
  {
    // 로비 ES 모듈
    files: ["ui/**/*.js", "landing.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    rules: { ...js.configs.recommended.rules, ...sharedRules },
  },
  {
    // Cloudflare Worker와 빌드 스크립트/테스트 ES 모듈
    files: ["server/*.mjs", "scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        WebSocketPair: "readonly",
        WebSocketRequestResponsePair: "readonly",
        WebSocket: "readonly",
      },
    },
    rules: { ...js.configs.recommended.rules, ...sharedRules },
  },
];
