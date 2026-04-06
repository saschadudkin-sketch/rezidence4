import { classifyHttpError, ERROR_KIND } from '../services/http/errorTaxonomy';

export type ErrorContext =
  | 'auth.send_code'
  | 'auth.verify'
  | 'visitlog.clear'
  | 'request.submit'
  | 'default';

export type PresentedError = {
  message: string;
  cta?: string;
  kind: string;
};

const COPY_BY_CONTEXT: Record<ErrorContext, Partial<Record<string, PresentedError>>> = {
  'auth.send_code': {
    [ERROR_KIND.NETWORK]: { message: 'Нет соединения. Проверьте интернет и повторите отправку кода.', cta: 'Повторить', kind: ERROR_KIND.NETWORK },
    [ERROR_KIND.VALIDATION]: { message: 'Проверьте номер телефона и попробуйте снова.', cta: 'Исправить', kind: ERROR_KIND.VALIDATION },
    [ERROR_KIND.UNKNOWN]: { message: 'Не удалось отправить SMS-код. Попробуйте ещё раз.', cta: 'Повторить', kind: ERROR_KIND.UNKNOWN },
  },
  'auth.verify': {
    [ERROR_KIND.AUTH]: { message: 'Код истёк или недействителен. Запросите новый SMS-код.', cta: 'Запросить код', kind: ERROR_KIND.AUTH },
    [ERROR_KIND.VALIDATION]: { message: 'Проверьте код из SMS и попробуйте снова.', cta: 'Проверить', kind: ERROR_KIND.VALIDATION },
    [ERROR_KIND.UNKNOWN]: { message: 'Не удалось выполнить вход. Попробуйте ещё раз.', cta: 'Повторить', kind: ERROR_KIND.UNKNOWN },
  },
  'visitlog.clear': {
    [ERROR_KIND.FORBIDDEN]: { message: 'Недостаточно прав для очистки журнала.', kind: ERROR_KIND.FORBIDDEN },
    [ERROR_KIND.NETWORK]: { message: 'Журнал не очищен: нет соединения с сервером.', cta: 'Повторить', kind: ERROR_KIND.NETWORK },
    [ERROR_KIND.UNKNOWN]: { message: 'Не удалось очистить журнал. Попробуйте позже.', cta: 'Повторить', kind: ERROR_KIND.UNKNOWN },
  },
  'request.submit': {
    [ERROR_KIND.NETWORK]: { message: 'Заявка сохранена локально. Синхронизируем при восстановлении сети.', cta: 'Ок', kind: ERROR_KIND.NETWORK },
    [ERROR_KIND.UNKNOWN]: { message: 'Ошибка при отправке заявки. Попробуйте снова.', cta: 'Повторить', kind: ERROR_KIND.UNKNOWN },
  },
  default: {
    [ERROR_KIND.UNKNOWN]: { message: 'Произошла ошибка. Попробуйте снова.', cta: 'Повторить', kind: ERROR_KIND.UNKNOWN },
  },
};

export function presentError(error: unknown, context: ErrorContext = 'default'): PresentedError {
  const e = error as { kind?: string; status?: number; message?: string };
  const kind = e?.kind || classifyHttpError(e?.status, e?.message);
  const fromContext = COPY_BY_CONTEXT[context]?.[kind] || COPY_BY_CONTEXT[context]?.[ERROR_KIND.UNKNOWN];
  const fallback = COPY_BY_CONTEXT.default[ERROR_KIND.UNKNOWN] as PresentedError;
  return fromContext || fallback;
}
