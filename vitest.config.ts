import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		alias: {
			obsidian: "./tests/__mocks__/obsidian.ts",
		},
		passWithNoTests: true,
	},
	resolve: {
		alias: {
			src: "./src",
		},
	},
});
