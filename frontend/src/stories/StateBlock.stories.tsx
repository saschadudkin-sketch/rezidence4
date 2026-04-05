import StateBlock from '../ui/StateBlock';

export default {
  title: 'UI/StateBlock',
  component: StateBlock,
  tags: ['autodocs'],
  argTypes: {
    type: {
      control: 'radio',
      options: ['empty', 'loading', 'error'],
    },
  },
};

export const Empty = {
  args: {
    type: 'empty',
    title: 'Нет заявок',
    subtitle: 'Здесь будут отображаться ваши заявки',
  },
};

export const Loading = {
  args: {
    type: 'loading',
    title: 'Загрузка…',
  },
};

export const Error = {
  args: {
    type: 'error',
    title: 'Ошибка загрузки',
    subtitle: 'Не удалось получить данные с сервера',
    actionLabel: 'Попробовать снова',
    onAction: () => alert('Retry clicked'),
  },
};

export const WithAction = {
  args: {
    type: 'empty',
    title: 'Список пуст',
    subtitle: 'Создайте первую запись',
    actionLabel: 'Добавить',
    onAction: () => {},
  },
};
