export type ViewStateKind = 'loading' | 'empty' | 'error';
export type ViewEntity = 'residents' | 'garage' | 'visitlog' | 'blacklist' | 'requests' | 'default';

const COPY: Record<ViewEntity, Record<ViewStateKind, { title: string; subtitle: string }>> = {
  residents: {
    loading: { title: 'Загружаем список жильцов', subtitle: 'Пожалуйста, подождите' },
    empty: { title: 'Ничего не найдено', subtitle: 'Попробуйте изменить поисковый запрос' },
    error: { title: 'Не удалось загрузить жильцов', subtitle: 'Проверьте соединение и попробуйте снова' },
  },
  garage: {
    loading: { title: 'Загружаем автомобили', subtitle: 'Пожалуйста, подождите' },
    empty: { title: 'Машины не добавлены', subtitle: 'Добавьте автомобиль для быстрого создания пропусков на парковку' },
    error: { title: 'Не удалось загрузить автомобили', subtitle: 'Проверьте соединение и попробуйте снова' },
  },
  visitlog: {
    loading: { title: 'Загрузка журнала...', subtitle: 'Пожалуйста, подождите' },
    empty: { title: 'Журнал пока пуст', subtitle: 'События появятся после первых проходов' },
    error: { title: 'Не удалось загрузить журнал', subtitle: 'Проверьте соединение и попробуйте снова' },
  },
  blacklist: {
    loading: { title: 'Загрузка чёрного списка', subtitle: 'Пожалуйста, подождите' },
    empty: { title: 'Список пуст', subtitle: 'Нажмите «+ Добавить», чтобы внести запись' },
    error: { title: 'Не удалось загрузить чёрный список', subtitle: 'Проверьте соединение и попробуйте снова' },
  },
  requests: {
    loading: { title: 'Загрузка заявок', subtitle: 'Пожалуйста, подождите' },
    empty: { title: 'Заявок пока нет', subtitle: 'Создайте первую заявку' },
    error: { title: 'Не удалось загрузить заявки', subtitle: 'Проверьте соединение и попробуйте снова' },
  },
  default: {
    loading: { title: 'Загрузка данных', subtitle: 'Пожалуйста, подождите' },
    empty: { title: 'Пока ничего нет', subtitle: 'Попробуйте позже или измените фильтры' },
    error: { title: 'Не удалось загрузить данные', subtitle: 'Проверьте соединение и попробуйте снова' },
  },
};

export function getViewStateCopy(entity: ViewEntity, kind: ViewStateKind) {
  return (COPY[entity] || COPY.default)[kind];
}
