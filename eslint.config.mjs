import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/core/**/*.ts'],
    rules: {
      /**
       * The architectural promise, mechanically enforced.
       *
       * The design commits to extracting this core into an editor-agnostic sidecar (Neovim, Zed,
       * the eventual Rust rewrite). One convenient `import * as vscode` in here turns that
       * extraction from a refactor into a rewrite, and nothing else in the pipeline would notice.
       * A lint rule catches it in seconds; code review catches it in about six months.
       */
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'vscode',
              message:
                'src/core must stay editor-agnostic — put editor bindings in src/vscode instead.',
            },
          ],
          patterns: ['**/vscode/**'],
        },
      ],
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  }
);
