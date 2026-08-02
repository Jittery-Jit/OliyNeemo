import js from '@eslint/js'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import functional from 'eslint-plugin-functional'
import tseslint from 'typescript-eslint'

export default tseslint.config(
	{
		ignores: [
			'.next/**',
			'.open-next/**',
			'.wrangler/**',
			'android/**',
			'dist/**',
			'ios/**',
			'node_modules/**',
			'out/**',
			'public/neemo-local-gateway.zip',
			'work/**',
			'next-env.d.ts',
			'worker-configuration.d.ts',
		],
	},
	js.configs.recommended,
	...nextVitals,
	...nextTs,
	{
		files: ['**/*.{ts,tsx,mts}'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
			globals: {
				console: 'readonly',
				process: 'readonly',
			},
		},
		plugins: functional.configs.recommended.plugins,
		rules: {
			...functional.configs.recommended.rules,
			'functional/functional-parameters': 'off',
			'functional/immutable-data': 'off',
			'functional/no-conditional-statements': 'off',
			'functional/no-expression-statements': 'off',
			'functional/no-let': 'off',
			'functional/no-loop-statements': 'off',
			'functional/no-return-void': 'off',
			'functional/no-throw-statements': 'off',
			'functional/prefer-immutable-types': 'off',
			'@next/next/no-img-element': 'off',
		},
	},
)
