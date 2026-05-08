/** @type { import('@storybook/react-vite').StorybookConfig } */
const config = {
  stories: ['../src/**/*.stories.@(js|jsx|ts|tsx|mdx)'],
  addons: [
    '@storybook/addon-a11y',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  viteFinal: async (config) => ({
    ...config,
    plugins: (config.plugins ?? [])
      .flat()
      .filter((plugin) => !plugin?.name?.startsWith('vite-plugin-pwa')),
  }),
  docs: {
    autodocs: 'tag',
  },
};

export default config;
