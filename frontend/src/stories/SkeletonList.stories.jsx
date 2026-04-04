import { SkeletonList } from '../ui/SkeletonList';

export default {
  title: 'UI/SkeletonList',
  component: SkeletonList,
  tags: ['autodocs'],
  argTypes: {
    count: {
      control: { type: 'range', min: 1, max: 10, step: 1 },
      description: 'Number of skeleton items to render',
    },
  },
};

export const Default = {
  args: { count: 3 },
};

export const Single = {
  args: { count: 1 },
};

export const Many = {
  args: { count: 8 },
};
