import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist/**', 'storybook-static/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: false,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='style']",
          message: 'Inline style is forbidden in product UI. Use design tokens/classes instead.',
        },
      ],
    },
  },
  {
    files: ['src/**/*.{test,spec}.{ts,tsx}', 'src/**/*.smoke.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      // Tests intentionally use `any` for mock flexibility (vi.spyOn with
      // generic selectors, partial state shapes, etc). Production rules
      // still apply to src/**.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  // Runtime layout / variable-driven infra components where style is part of behavior
  // (virtualization coordinates, dynamic avatar sizing, CSS variable progress).
  {
    files: [
      'src/ui/VirtualList.tsx',
      'src/requests/GroupedReqList.tsx',
      'src/ui/PhotoLightbox.tsx',
      'src/ui/AvatarCircle.tsx',
      'src/requests/ReqCard.tsx',
      'src/views/Login.tsx',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  // Design-system primitives and their demo page ARE the token layer that
  // `no-restricted-syntax` is trying to protect — their whole job is to
  // emit inline styles backed by CSS variables. The rule targets *product
  // UI*, not the primitives themselves.
  {
    files: [
      'src/design-system/components/**/*.{ts,tsx}',
      'src/ui/Avatar/Avatar.tsx',
      'src/views/DesignSystemDemo.tsx',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  // Legacy product UI surfaces with pre-existing inline styles. Scheduled
  // for extraction to CSS classes (BACKLOG ARCH-8). New inline styles in
  // these files should NOT be added — prefer utility classes / tokens.
  {
    files: [
      'src/admin/pages/AuditLogPage.tsx',
      'src/admin/pages/DashboardPage.tsx',
      'src/admin/pages/ManagementCompanyDetailPage.tsx',
      'src/admin/pages/PropertyDetailPage.tsx',
      'src/components/ConsentModal.tsx',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
];
