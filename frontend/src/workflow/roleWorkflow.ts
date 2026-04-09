import { getRoleResponsibilities } from '../domain/roleResponsibilities';

export type WorkflowMetrics = {
  pendingP: number;
  pendingT: number;
  unreadMsgs: number;
  residentNewStatuses: number;
};

export type WorkflowAction = {
  tab: string;
  title: string;
  subtitle: string;
  cta?: string;
};

export function getRoleNextBestAction(role: string, metrics: WorkflowMetrics): WorkflowAction | null {
  const conciergeRole = getRoleResponsibilities('concierge');
  const securityRole = getRoleResponsibilities('security');

  const byRole: Record<string, WorkflowAction> = {
    owner: {
      tab: 'passes',
      title: 'Следующий шаг: создать пропуск',
      subtitle: 'Добавьте гостя или курьера',
      cta: 'Создать пропуск',
    },
    tenant: {
      tab: 'passes',
      title: 'Следующий шаг: оформить пропуск',
      subtitle: 'Подготовьте доступ для посетителя',
      cta: 'Открыть пропуска',
    },
    contractor: {
      tab: 'tech',
      title: 'Следующий шаг: проверить заявки',
      subtitle: 'Убедитесь, что новые обращения обработаны',
      cta: 'Открыть техслужбу',
    },
    concierge: metrics.pendingP > 0
      ? {
          tab: 'passes',
          title: conciergeRole.queueTitle || 'Следующий шаг: провести доступ',
          subtitle: conciergeRole.queueSubtitle || 'Создайте заявку, найдите пропуск или отсканируйте QR-код для посетителя',
          cta: 'Открыть операции',
        }
      : {
          tab: 'visitlog',
          title: 'Следующий шаг: проверить журнал',
          subtitle: 'Посмотрите последние визиты и решения по доступу.',
          cta: 'Открыть журнал',
        },
    security: metrics.pendingP > 0
      ? {
          tab: 'guardpost',
          title: securityRole.queueTitle || 'Следующий шаг: подтвердить доступ',
          subtitle: securityRole.queueSubtitle || 'Подтвердите заявку, отсканируйте QR-код или отметьте прибытие посетителя',
          cta: 'Открыть пост',
        }
      : {
          tab: 'visitlog',
          title: 'Следующий шаг: проверить журнал доступа',
          subtitle: 'Посмотрите последние допуски, отказы и QR-проверки.',
          cta: 'Открыть журнал',
        },
    admin: metrics.pendingP > 0
      ? {
          tab: 'requests',
          title: 'Следующий шаг: завершить контроль',
          subtitle: 'Проверьте заявки и ключевые метрики',
          cta: 'Открыть контроль',
        }
      : {
          tab: 'stats',
          title: 'Следующий шаг: проверить аналитику',
          subtitle: 'Сверьте сводку по ролям, SLA и новым статусам.',
          cta: 'Открыть аналитику',
        },
  };

  return byRole[role] || null;
}

export function getWorkflowCompletionFeedback(role: string, metrics: WorkflowMetrics) {
  if (role === 'security') return `Ожидают проверки: ${metrics.pendingP}.`;
  if (role === 'concierge') return `Операций в очереди: ${metrics.pendingP + metrics.pendingT}.`;
  if (role === 'admin') return `Новых статусов: ${metrics.residentNewStatuses}, непрочитанных чатов: ${metrics.unreadMsgs}.`;
  return `Непрочитанных чатов: ${metrics.unreadMsgs}.`;
}
