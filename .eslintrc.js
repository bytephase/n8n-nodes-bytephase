/**
 * The rules n8n applies when reviewing a community node. Run `npm run lint` before
 * tagging a release — verification checks the same things.
 */
module.exports = {
	root: true,
	env: { browser: true, es6: true, node: true },
	parserOptions: {
		sourceType: 'module',
	},
	ignorePatterns: ['.eslintrc.js', '**/*.js', '**/node_modules/**', '**/dist/**'],
	overrides: [
		{
			files: ['package.json'],
			parser: '@typescript-eslint/parser',
			parserOptions: { extraFileExtensions: ['.json'] },
			plugins: ['eslint-plugin-n8n-nodes-base'],
			extends: ['plugin:n8n-nodes-base/community'],
			rules: {
				'n8n-nodes-base/community-package-json-name-still-default': 'off',
			},
		},
		{
			files: ['./credentials/**/*.ts'],
			parser: '@typescript-eslint/parser',
			parserOptions: { project: ['./tsconfig.json'], sourceType: 'module' },
			plugins: ['eslint-plugin-n8n-nodes-base'],
			extends: ['plugin:n8n-nodes-base/credentials'],
			rules: {
				'n8n-nodes-base/cred-class-field-documentation-url-missing': 'off',
				'n8n-nodes-base/cred-class-field-documentation-url-miscased': 'off',
			},
		},
		{
			files: ['./nodes/**/*.ts'],
			parser: '@typescript-eslint/parser',
			parserOptions: { project: ['./tsconfig.json'], sourceType: 'module' },
			plugins: ['eslint-plugin-n8n-nodes-base'],
			extends: ['plugin:n8n-nodes-base/nodes'],
			rules: {
				'n8n-nodes-base/node-execute-block-missing-continue-on-fail': 'off',
				'n8n-nodes-base/node-resource-description-filename-against-convention': 'off',
				'n8n-nodes-base/node-param-fixed-collection-type-unsorted-items': 'off',
				// n8n's verification lint requires NodeConnectionTypes.Main instead of 'main'
				'n8n-nodes-base/node-class-description-inputs-wrong-regular-node': 'off',
				'n8n-nodes-base/node-class-description-outputs-wrong': 'off',
			},
		},
	],
};
