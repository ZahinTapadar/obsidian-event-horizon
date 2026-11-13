import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

export default tseslint.config(
	{ ignores: ["main.js", "node_modules/", "scripts/", "esbuild.config.mjs", "tests/"] },
	...obsidianmd.configs.recommended,
	{ files: ["src/**/*.ts"], languageOptions: { parserOptions: { project: "./tsconfig.json" } } },
);
