export type ViewStateKind = 'loading' | 'empty' | 'error';
export type ViewEntity =
  | 'residents' | 'garage' | 'visitlog' | 'blacklist' | 'requests'
  | 'passes' | 'tech' | 'history' | 'templates'
  | 'security_passes' | 'security_tech' | 'security_perms'
  | 'admin_users' | 'admin_requests' | 'admin_perms'
  | 'default';

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
  passes: {
    loading: { title: 'Загрузка пропусков', subtitle: 'Пожалуйста, подождите' },
    empty: { title: 'Пропусков пока нет', subtitle: 'Создайте первый пропуск, чтобы открыть въезд без звонков и ожидания' },
    error: { title: 'Не удалось загрузить пропуска', subtitle: 'Проверьте соединение и попробуйте снова' },
  },
  tech: {
    loading: { title: 'Загрузка техзаявок', subtitle: 'Пожалуйста, подождите' },
    empty: { title: 'Заявок нет', subtitle: 'Нажмите на категорию выше, чтобы вызвать техслужбу' },
    error: { title: 'Не удалось загрузить техзаявки', subtitle: 'Проверьте соединение и попробуйте снова' },
  },
  history: {
    loading: { title: 'Загрузка истории', subtitle: 'Пожалуйста, подождите' },
    empty: { title: 'Нет завершённых заявок', subtitle: 'Здесь появятся завершённые, отклонённые и отменённые заявки' },
    error: { title: 'Не удалось загрузить историю', subtitle: 'Проверьте соединение и попробуйте снова' },
  },
  templates: {
    loading: { title: 'Загрузка шаблонов', subtitle: 'Пожалуйста, подождите' },
    empty: { title: 'Шаблонов нет', subtitle: 'При создании заявки нажмите «Сохранить как шаблон»' },
    error: { title: 'Не удалось загрузить шаблоны', subtitle: 'Проверьте соединение и попробуйте снова' },
  },
  security_passes: {
    loading: { title: 'Загрузка пропусков', subtitle: 'Пожалуйста, подождите' },
    empty: { title: 'Пропусков нет', subtitle: 'Заявки на пропуск не найдены' },
    error: { title: 'Не удалось загрузить пропуска', subtitle: 'Проверьте соединение и попробуйте снова' },
  },
  security_tech: {
    loading: { title: 'Загрузка техзаявок', subtitle: 'Пожалуйста, подождите' },
    empty: { title: 'Техзаявок нет', subtitle: 'Заявки в техслужбу не найдены' },
    error: { title: 'Не удалось загрузить техзаявки', subtitle: 'Проверьте соединение и попробуйте снова' },
  },
  security_perms: {
    loading: { title: 'Загрузка постоянных списков', subtitle: 'Пожалуйста, подождите' },
    empty: { title: 'Списки пусты', subtitle: 'Резиденты ещё не добавили постоянных посетителей/рабочих' },
    error: { title: 'Не удалось загрузить списки', subtitle: 'Проверьте соединение и попробуйте снова' },
  },
  admin_users: {
    loading: { title: 'Загрузка пользователей', subtitle: 'Пожалуйста, подождите' },
    empty: { title: 'Пользователей нет', subtitle: 'Добавьте первого пользователя' },
    error: { title: 'Не удалось загрузить пользователей', subtitle: 'Проверьте соединение и попробуйте снова' },
  },
  admin_requests: {
    loading: { title: 'Загрузка заявок', subtitle: 'Пожалуйста, подождите' },
    empty: { title: 'Заявок нет', subtitle: 'Измените фильтры или период поиска' },
    error: { title: 'Не удалось загрузить заявки', subtitle: 'Проверьте соединение и попробуйте снова' },
  },
  admin_perms: {
    loading: { title: 'Загрузка постоянных списков', subtitle: 'Пожалуйста, подождите' },
    empty: { title: 'Списки пусты', subtitle: 'Жильцы ещё не заполнили постоянные списки' },
    error: { title: 'Не удалось загрузить списки', subtitle: 'Проверьте соединение и попробуйте снова' },
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
