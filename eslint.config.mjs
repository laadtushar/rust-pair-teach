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

      /**
       * The other architectural promise, which until now was only a habit.
       *
       * Every judgement in here takes `now` as an argument. That is what lets a 45-minute recorded
       * session replay in milliseconds, lets the fading tests jump six months forward, and lets the
       * cooldown logic be tested at all. One `Date.now()` reaching for the wall clock makes the
       * enclosing test either slow or flaky, and it would pass review — the boundary rule above was
       * enforced from the start while this one was left to discipline, for no reason other than
       * that nobody had broken it yet.
       *
       * `new Date(someTimestamp)` stays legal: it converts a number that was already injected.
       * Only the zero-argument reach for the clock is forbidden.
       */
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message:
            'src/core takes `now` as a parameter — reaching for the clock here breaks session replay. Inject it, or use src/core/clock.ts.',
        },
        {
          selector: 'NewExpression[callee.name="Date"][arguments.length=0]',
          message:
            'src/core takes `now` as a parameter — `new Date()` breaks session replay. `new Date(now)` is fine.',
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message:
            'src/core must be deterministic so recorded sessions replay identically. Derive variation from something injected, as staticHint does from the encounter count.',
        },
      ],
    },
  },
  {
    // The clock is the one place allowed to read the clock; that is what makes it the seam.
    files: ['src/core/clock.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  }
);
