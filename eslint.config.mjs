import tsparser from '@typescript-eslint/parser'
import { defineConfig } from 'eslint/config'
import obsidianmd from 'eslint-plugin-obsidianmd'

export default defineConfig([
	{
		linterOptions: {
			reportUnusedDisableDirectives: 'off',
		},
	},
	{
		ignores: [
			'dist/**',
			'node_modules/**',
			'main.js',
			'package-lock.json',
			'src/mcp-server.ts',
			// The server/ subtree has its own tsconfig + eslint config — lint it from there,
			// not from the plugin root. Without this carve-out, the plugin's typed @typescript-eslint
			// rules try to load server files under the plugin's tsconfig and fail because the
			// server files aren't in the project graph (parserOptions.project is plugin-only).
			'server/**',
		],
	},
	...obsidianmd.configs.recommended,
	{
		files: ['src/**/*.ts'],
		ignores: ['src/mcp-server.ts'],
		languageOptions: {
			parser: tsparser,
			parserOptions: {
				project: './tsconfig.json',
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unsafe-return': 'off',
		},
	},
])
