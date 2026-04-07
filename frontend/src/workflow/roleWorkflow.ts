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
  cta: string;
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
    concierge: {
      tab: metrics.pendingP > 0 ? 'passes' : 'visitlog',
      title: conciergeRole.queueTitle || 'Следующий шаг: помочь с доступом',
      subtitle: conciergeRole.queueSubtitle || 'Создайте заявку, найдите пропуск или отсканируйте QR-код для посетителя',
      cta: 'Открыть заявки',
    },
    security: {
      tab: metrics.pendingP > 0 ? 'guardpost' : 'visitlog',
      title: securityRole.queueTitle || 'Следующий шаг: проверить пост',
      subtitle: securityRole.queueSubtitle || 'Подтвердите заявку, отсканируйте QR-код или отметьте прибытие посетителя',
      cta: 'Открыть пост',
    },
    admin: {
      tab: metrics.pendingP > 0 ? 'requests' : 'stats',
      title: 'Следующий шаг: завершить контроль',
      subtitle: 'Проверьте заявки и ключевые метрики',
      cta: 'Открыть контроль',
    },
  };

  return byRole[role] || null;
}

export function getWorkflowCompletionFeedback(role: string, metrics: WorkflowMetrics) {
  if (role === 'security') return `Ожидают проверки: ${metrics.pendingP}.`;
  if (role === 'concierge') return `Заявок в очереди: ${metrics.pendingP + metrics.pendingT}.`;
  if (role === 'admin') return `Новых статусов: ${metrics.residentNewStatuses}, непрочитанных чатов: ${metrics.unreadMsgs}.`;
  return `Непрочитанных чатов: ${metrics.unreadMsgs}.`;
}
