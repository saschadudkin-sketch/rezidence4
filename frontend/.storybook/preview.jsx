import '../src/styles/tokens.css';
import '../src/styles/foundations.css';
import '../src/styles/theme.css';

/** @type { import('@storybook/react').Preview } */
const preview = {
  parameters: {
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark',  value: '#1a1a2e' },
        { name: 'light', value: '#f5f5f5' },
      ],
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    docs: {
      toc: true,
    },
  },
};

export default preview;
