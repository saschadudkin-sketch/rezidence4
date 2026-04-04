import { AppIcon, APP_ICON_NAMES } from '../ui/AppIcon';

export default {
  title: 'UI/AppIcon',
  component: AppIcon,
  tags: ['autodocs'],
  argTypes: {
    name: {
      control: 'select',
      options: APP_ICON_NAMES,
      description: 'Icon name',
    },
    size: {
      control: { type: 'range', min: 12, max: 48, step: 2 },
      description: 'Icon size in px',
    },
    strokeWidth: {
      control: { type: 'range', min: 1, max: 3, step: 0.1 },
      description: 'SVG stroke width',
    },
  },
};

export const Default = {
  args: { name: 'ticket', size: 24 },
};

export const AllIcons = {
  render: () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
      {APP_ICON_NAMES.map(name => (
        <div key={name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 60 }}>
          <AppIcon name={name} size={22} />
          <span style={{ fontSize: 10, color: 'var(--text-sub, #aaa)' }}>{name}</span>
        </div>
      ))}
    </div>
  ),
  name: 'All Icons',
};

export const Sizes = {
  render: () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      {[12, 16, 20, 24, 32, 40].map(size => (
        <AppIcon key={size} name="shield" size={size} />
      ))}
    </div>
  ),
};
