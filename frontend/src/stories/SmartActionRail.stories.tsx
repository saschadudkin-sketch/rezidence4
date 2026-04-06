import { SmartActionRail } from '../workflow/SmartActionRail';

export default {
  title: 'Workflow/SmartActionRail',
  component: SmartActionRail,
};

const baseAction = {
  title: 'Следующий шаг: создать пропуск',
  subtitle: 'Добавьте гостя или курьера',
  cta: 'Создать пропуск',
};

export const Default = {
  args: {
    action: baseAction,
    feedback: 'Непрочитанных чатов: 2.',
    onAction: () => {},
  },
};

export const WithoutFeedback = {
  args: {
    action: baseAction,
    feedback: '',
    onAction: () => {},
  },
};
