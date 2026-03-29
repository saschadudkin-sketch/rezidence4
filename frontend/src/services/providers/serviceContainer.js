import { createServices } from './createServices';

/**
 * Единый сервис-контейнер приложения.
 * Используется UI-слоем как точка входа в mode-aware сервисы.
 */
export const services = createServices();
