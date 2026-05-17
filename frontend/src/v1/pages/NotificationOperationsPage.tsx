import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  isV1ApiError,
  type AdminOutboxMetrics,
  type AdminOutboxRow,
  type AdminOutboxSla,
  type NotificationChannel,
  type NotificationLogMetrics,
  type NotificationLogPeriod,
  type NotificationLogRow,
  type NotificationLogStatus,
  type OutboxHealthResponse,
  type OutboxStatus,
} from '../api';
import { useV1Session } from '../store';
import { getPropertyLabels } from '../lib/propertyLabels';
import { formatDateTime } from '../components/formatters';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Inline,
  Input,
  Select,
  Spinner,
  Stack,
  uiClasses,
} from '../components/ui';
import type { BadgeTone } from '../components/ui';

const CHANNELS: NotificationChannel[] = ['web_push', 'sms', 'telegram', 'webhook', 'email'];
const OUTBOX_STATUSES: OutboxStatus[] = ['pending', 'in_flight', 'sent', 'failed', 'dead'];
const LOG_STATUSES: NotificationLogStatus[] = ['sent', 'failed'];
const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  web_push: 'В приложении',
  sms: 'SMS',
  telegram: 'Telegram',
  webhook: 'Webhook',
  email: 'Email',
};
const STATUS_LABELS: Record<OutboxStatus | NotificationLogStatus, string> = {
  pending: 'В очереди',
  in_flight: 'Отправляется',
  sent: 'Отправлено',
  failed: 'Ошибка',
  dead: 'Не доставлено',
};
const EVENT_LABELS: Record<string, string> = {
  'access.request.created': 'Создана заявка на доступ',
  'access.request.status_changed': 'Изменён статус заявки',
  'announcement.published': 'Опубликовано объявление',
  'package.received': 'Принята посылка',
  'package.reminder': 'Напоминание о посылке',
  'package.followup': 'Повторное напоминание о посылке',
  'package.admin_alert': 'Эскалация по посылке',
};
const PERIODS: Array<{ value: NotificationLogPeriod; label: string; hours: number }> = [
  { value: '24h', label: '24 часа', hours: 24 },
  { value: '7d', label: '7 дней', hours: 24 * 7 },
  { value: '30d', label: '30 дней', hours: 24 * 30 },
];

function sinceForPeriod(period: NotificationLogPeriod): string {
  const match = PERIODS.find((item) => item.value === period) ?? PERIODS[0];
  return new Date(Date.now() - match.hours * 60 * 60 * 1000).toISOString();
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 1,
    style: 'percent',
  }).format(value);
}

function statusTone(status: OutboxStatus | NotificationLogStatus): BadgeTone {
  if (status === 'sent') return 'success';
  if (status === 'failed') return 'warning';
  if (status === 'dead') return 'error';
  if (status === 'pending' || status === 'in_flight') return 'info';
  return 'neutral';
}

function statusLabel(status: OutboxStatus | NotificationLogStatus): string {
  return STATUS_LABELS[status] ?? status;
}

function channelLabel(channel: NotificationChannel): string {
  return CHANNEL_LABELS[channel] ?? channel;
}

function recipientLabel(recipientType: string): string {
  if (recipientType === 'resident') return 'Житель';
  if (recipientType === 'staff') return 'Сотрудник';
  if (recipientType === 'contractor') return 'Подрядчик';
  if (recipientType === 'external') return 'Внешний адрес';
  return recipientType;
}

function eventLabel(eventType: string): string {
  return EVENT_LABELS[eventType] ?? 'Системное уведомление';
}

function payloadPreview(payload: Record<string, unknown> | null): string {
  if (!payload) return '—';
  const text = JSON.stringify(payload);
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

function errorMessage(error: unknown): string {
  return isV1ApiError(error) ? error.message : 'неизвестная ошибка';
}

export function NotificationOperationsPage() {
  const session = useV1Session();
  const labels = useMemo(() => getPropertyLabels(session.property_type), [session.property_type]);
  const propertyId = session.property_id ?? null;
  const [outboxStatus, setOutboxStatus] = useState<OutboxStatus | ''>('pending');
  const [channel, setChannel] = useState<NotificationChannel | ''>('');
  const [query, setQuery] = useState('');
  const [logStatus, setLogStatus] = useState<NotificationLogStatus | ''>('');
  const [period, setPeriod] = useState<NotificationLogPeriod>('24h');
  const [pendingCancelId, setPendingCancelId] = useState<string | null>(null);
  const [pendingBulkRetry, setPendingBulkRetry] = useState<'failed' | 'dead' | null>(null);
  const [openPayloadIds, setOpenPayloadIds] = useState<Set<string>>(() => new Set());
  const queryClient = useQueryClient();

  const outboxParams = useMemo(() => ({
    status: outboxStatus || undefined,
    channel: channel || undefined,
    q: query.trim() || undefined,
    limit: 50,
  }), [outboxStatus, channel, query]);

  const outboxMetrics = useQuery({
    queryKey: ['v1', 'admin-outbox', 'metrics', propertyId],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.adminOutbox.metrics({ signal }),
  });
  const outboxSla = useQuery({
    queryKey: ['v1', 'admin-outbox', 'sla', propertyId],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.adminOutbox.sla({ signal }),
  });
  const outboxHealth = useQuery({
    queryKey: ['v1', 'notifications-outbox', 'health', propertyId],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.adminOutbox.health({ signal }),
  });
  const outboxList = useQuery({
    queryKey: ['v1', 'admin-outbox', 'list', propertyId, outboxParams],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.adminOutbox.list(outboxParams, { signal }),
  });
  const notificationMetrics = useQuery({
    queryKey: ['v1', 'notification-log', 'metrics', propertyId, period],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.notificationLog.metrics(period, { signal }),
  });
  const notificationMeta = useQuery({
    queryKey: ['v1', 'notification-log', 'meta', propertyId],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.notificationLog.meta({ signal }),
  });
  const notificationList = useQuery({
    queryKey: ['v1', 'notification-log', 'list', propertyId, period, channel, logStatus],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.notificationLog.list({
      since: sinceForPeriod(period),
      channel: channel || undefined,
      status: logStatus || undefined,
      limit: 50,
    }, { signal }),
  });

  const invalidateOutbox = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['v1', 'admin-outbox'] }),
      queryClient.invalidateQueries({ queryKey: ['v1', 'notifications-outbox'] }),
      queryClient.invalidateQueries({ queryKey: ['v1', 'notification-log'] }),
    ]);
  };

  const requeue = useMutation({
    mutationFn: (id: string) => api.adminOutbox.requeue(id),
    onSuccess: invalidateOutbox,
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.adminOutbox.cancel(id),
    onSuccess: async () => {
      setPendingCancelId(null);
      await invalidateOutbox();
    },
  });
  const retryBulk = useMutation({
    mutationFn: (status: 'failed' | 'dead') => api.adminOutbox.retry({ status, limit: 100 }),
    onSuccess: async () => {
      setPendingBulkRetry(null);
      await invalidateOutbox();
    },
  });
  const outboxDetail = useMutation({
    mutationFn: (id: string) => api.adminOutbox.getById(id),
  });
  const notificationDetail = useMutation({
    mutationFn: (id: string) => api.notificationLog.getById(id),
  });

  const error = outboxMetrics.error
    || outboxSla.error
    || outboxHealth.error
    || outboxList.error
    || notificationMetrics.error
    || notificationMeta.error
    || notificationList.error;

  const togglePayload = (id: string) => {
    setOpenPayloadIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!propertyId) {
    return (
      <div className={uiClasses.pageShell}>
        <header className={uiClasses.pageHeader}>
          <h1 className={uiClasses.pageTitle}>Уведомления и outbox</h1>
        </header>
        <Alert tone="warning">Администратор не привязан к объекту.</Alert>
      </div>
    );
  }

  return (
    <div className={uiClasses.pageShell}>
      <header className={uiClasses.pageHeader}>
        <h1 className={uiClasses.pageTitle}>Уведомления и outbox</h1>
        <p className={uiClasses.pageSubtitle}>
          {labels.propertyKind}: доставка, ошибки провайдеров и ручное восстановление очереди.
        </p>
      </header>

      <Stack>
        <Card>
          <Inline>
            <Field id="notifications-period" label="Окно логов">
              <Select
                id="notifications-period"
                value={period}
                onChange={(event) => setPeriod(event.target.value as NotificationLogPeriod)}
              >
                {PERIODS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </Select>
            </Field>
            <Field id="notifications-channel" label="Канал">
              <Select
                id="notifications-channel"
                value={channel}
                onChange={(event) => setChannel(event.target.value as NotificationChannel | '')}
              >
                <option value="">Все каналы</option>
                {CHANNELS.map((item) => (
                  <option key={item} value={item}>{channelLabel(item)}</option>
                ))}
              </Select>
            </Field>
            <Field id="outbox-status" label="Статус outbox">
              <Select
                id="outbox-status"
                value={outboxStatus}
                onChange={(event) => setOutboxStatus(event.target.value as OutboxStatus | '')}
              >
                <option value="">Все</option>
                {OUTBOX_STATUSES.map((item) => (
                  <option key={item} value={item}>{statusLabel(item)}</option>
                ))}
              </Select>
            </Field>
            <Field id="log-status" label="Статус доставки">
              <Select
                id="log-status"
                value={logStatus}
                onChange={(event) => setLogStatus(event.target.value as NotificationLogStatus | '')}
              >
                <option value="">Все</option>
                {LOG_STATUSES.map((item) => (
                  <option key={item} value={item}>{statusLabel(item)}</option>
                ))}
              </Select>
            </Field>
            <Field id="outbox-q" label="Поиск outbox">
              <Input
                id="outbox-q"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="событие, correlation, адрес"
              />
            </Field>
          </Inline>
        </Card>

        {error ? (
          <Alert tone="error">Не удалось загрузить уведомления: {errorMessage(error)}</Alert>
        ) : null}
        {requeue.error ? (
          <Alert tone="error">Не удалось вернуть строку в очередь: {errorMessage(requeue.error)}</Alert>
        ) : null}
        {cancel.error ? (
          <Alert tone="error">Не удалось отменить строку: {errorMessage(cancel.error)}</Alert>
        ) : null}
        {retryBulk.error ? (
          <Alert tone="error">Не удалось восстановить outbox: {errorMessage(retryBulk.error)}</Alert>
        ) : null}
        {outboxDetail.error ? (
          <Alert tone="error">Не удалось загрузить строку outbox: {errorMessage(outboxDetail.error)}</Alert>
        ) : null}
        {notificationDetail.error ? (
          <Alert tone="error">Не удалось загрузить событие доставки: {errorMessage(notificationDetail.error)}</Alert>
        ) : null}

        <MetricsSection
          outbox={outboxMetrics.data ?? null}
          notifications={notificationMetrics.data ?? null}
          loading={outboxMetrics.isLoading || notificationMetrics.isLoading}
        />

        <OutboxHealthSection
          health={outboxHealth.data ?? null}
          sla={outboxSla.data ?? null}
          loading={outboxHealth.isLoading || outboxSla.isLoading}
          pendingBulkRetry={pendingBulkRetry}
          onRequestRetry={setPendingBulkRetry}
          onConfirmRetry={(status) => retryBulk.mutate(status)}
          onClearRetry={() => setPendingBulkRetry(null)}
          actionsDisabled={retryBulk.isPending}
        />

        <OutboxSection
          rows={outboxList.data?.items ?? []}
          loading={outboxList.isLoading}
          onRequeue={(id) => requeue.mutate(id)}
          onRequestCancel={setPendingCancelId}
          onConfirmCancel={(id) => cancel.mutate(id)}
          onClearCancel={() => setPendingCancelId(null)}
          pendingCancelId={pendingCancelId}
          detail={outboxDetail.data?.item ?? null}
          detailLoading={outboxDetail.isPending}
          onLoadDetail={(id) => outboxDetail.mutate(id)}
          openPayloadIds={openPayloadIds}
          onTogglePayload={togglePayload}
          actionsDisabled={requeue.isPending || cancel.isPending}
        />

        <NotificationLogSection
          rows={notificationList.data?.items ?? []}
          loading={notificationList.isLoading}
          limitMax={notificationMeta.data?.limit_max ?? null}
          detail={notificationDetail.data?.item ?? null}
          detailLoading={notificationDetail.isPending}
          onLoadDetail={(id) => notificationDetail.mutate(id)}
        />
      </Stack>
    </div>
  );
}

function MetricsSection({
  outbox,
  notifications,
  loading,
}: {
  outbox: AdminOutboxMetrics | null;
  notifications: NotificationLogMetrics | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <Card>
        <Inline><Spinner /><span className={uiClasses.textMuted}>Загрузка метрик…</span></Inline>
      </Card>
    );
  }

  const sent = notifications?.channels.reduce((sum, row) => sum + row.sent, 0) ?? 0;
  const failed = notifications?.channels.reduce((sum, row) => sum + row.failed, 0) ?? 0;
  const successRate = sent + failed === 0 ? null : sent / (sent + failed);

  return (
    <Stack>
      <section className={uiClasses.formGrid} aria-label="Метрики уведомлений">
        <KpiTile title="В очереди" value={outbox?.counts.pending ?? 0} tone={(outbox?.counts.pending ?? 0) > 0 ? 'warning' : 'success'} />
        <KpiTile title="Ошибки" value={outbox?.counts.failed ?? 0} tone={(outbox?.counts.failed ?? 0) > 0 ? 'warning' : 'success'} />
        <KpiTile title="Не доставлено" value={outbox?.counts.dead ?? 0} tone={(outbox?.counts.dead ?? 0) > 0 ? 'error' : 'success'} />
        <KpiTile title="Успешность" value={formatPercent(successRate)} tone={successRate !== null && successRate < 0.95 ? 'warning' : 'success'} />
      </section>

      <Card
        title="Каналы"
        subtitle={outbox?.generated_at ? `Outbox обновлён ${formatDateTime(outbox.generated_at)}` : undefined}
      >
        {outbox?.per_channel.length ? (
          <ul className={uiClasses.resourceList}>
            {outbox.per_channel.map((row) => (
              <li className={uiClasses.resourceRow} key={row.channel}>
                <div className={uiClasses.resourceRowMain}>
                  <p className={uiClasses.resourceTitle}>{channelLabel(row.channel)}</p>
                  <p className={uiClasses.resourceMeta}>
                    в очереди {formatNumber(row.pending)} · ошибки {formatNumber(row.failed)} · не доставлено {formatNumber(row.dead)}
                  </p>
                </div>
                <Badge tone={row.pending + row.failed + row.dead > 0 ? 'warning' : 'success'}>
                  отправлено {formatNumber(row.sent)}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>Нет данных по каналам.</EmptyState>
        )}
      </Card>
    </Stack>
  );
}

function OutboxHealthSection({
  health,
  sla,
  loading,
  pendingBulkRetry,
  onRequestRetry,
  onConfirmRetry,
  onClearRetry,
  actionsDisabled,
}: {
  health: OutboxHealthResponse | null;
  sla: AdminOutboxSla | null;
  loading: boolean;
  pendingBulkRetry: 'failed' | 'dead' | null;
  onRequestRetry: (status: 'failed' | 'dead') => void;
  onConfirmRetry: (status: 'failed' | 'dead') => void;
  onClearRetry: () => void;
  actionsDisabled: boolean;
}) {
  const failedCount = health?.counts.failed ?? 0;
  const deadCount = health?.counts.dead ?? 0;

  if (loading) {
    return (
      <Card>
        <Inline><Spinner /><span className={uiClasses.textMuted}>Загрузка health/SLA…</span></Inline>
      </Card>
    );
  }

  return (
    <Stack>
      <section className={uiClasses.formGrid} aria-label="Health и SLA outbox">
        <KpiTile
          title="Outbox worker"
          value={health?.feature_enabled ? 'включён' : 'выключен'}
          tone={health?.feature_enabled ? 'success' : 'warning'}
        />
        <KpiTile
          title="Зависли"
          value={health?.stuck_in_flight ?? 0}
          tone={(health?.stuck_in_flight ?? 0) > 0 ? 'warning' : 'success'}
        />
        <KpiTile
          title="Старше 14д"
          value={sla?.awaiting_pickup_over_14d ?? 0}
          tone={(sla?.awaiting_pickup_over_14d ?? 0) > 0 ? 'warning' : 'success'}
        />
        <KpiTile
          title="Эскалации"
          value={sla?.admin_alerts_sent_24h ?? 0}
          tone={(sla?.admin_alerts_sent_24h ?? 0) > 0 ? 'info' : 'neutral'}
        />
      </section>

      <Card
        title="Восстановление outbox"
        subtitle={health?.ts ? `Проверено ${formatDateTime(health.ts)}` : undefined}
      >
        <Stack>
          <p className={uiClasses.textMuted}>
            в очереди {formatNumber(health?.counts.pending ?? 0)} · ошибки {formatNumber(failedCount)} · не доставлено {formatNumber(deadCount)}
            {' · '}
            старейшее ожидание {health?.oldest_pending_age_seconds === null || health?.oldest_pending_age_seconds === undefined
              ? '—'
              : `${formatNumber(Math.floor(health.oldest_pending_age_seconds / 60))} мин`}
          </p>
          <Inline>
            {pendingBulkRetry === 'failed' ? (
              <>
                <Button
                  variant="danger"
                  disabled={actionsDisabled}
                  onClick={() => onConfirmRetry('failed')}
                >
                  Подтвердить повтор ошибок
                </Button>
                <Button variant="ghost" disabled={actionsDisabled} onClick={onClearRetry}>
                  Оставить
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                disabled={actionsDisabled || failedCount === 0}
                onClick={() => onRequestRetry('failed')}
              >
                Повторить ошибки
              </Button>
            )}
            {pendingBulkRetry === 'dead' ? (
              <>
                <Button
                  variant="danger"
                  disabled={actionsDisabled}
                  onClick={() => onConfirmRetry('dead')}
                >
                  Подтвердить повтор недоставленных
                </Button>
                <Button variant="ghost" disabled={actionsDisabled} onClick={onClearRetry}>
                  Оставить
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                disabled={actionsDisabled || deadCount === 0}
                onClick={() => onRequestRetry('dead')}
              >
                Повторить недоставленные
              </Button>
            )}
          </Inline>
        </Stack>
      </Card>

      <Card
        title="SLA по посылкам"
        subtitle={sla?.generated_at ? `SLA обновлён ${formatDateTime(sla.generated_at)}` : undefined}
      >
        <ul className={uiClasses.resourceList}>
          <li className={uiClasses.resourceRow}>
            <div className={uiClasses.resourceRowMain}>
              <p className={uiClasses.resourceTitle}>Посылки ожидают выдачи</p>
              <p className={uiClasses.resourceMeta}>
                всего {formatNumber(sla?.awaiting_pickup_total ?? 0)} · старше 7д {formatNumber(sla?.awaiting_pickup_over_7d ?? 0)}
                {' · '}
                старше 30д {formatNumber(sla?.awaiting_pickup_over_30d ?? 0)}
              </p>
            </div>
            <Badge tone={(sla?.awaiting_pickup_over_14d ?? 0) > 0 ? 'warning' : 'success'}>
              старше 14д {formatNumber(sla?.awaiting_pickup_over_14d ?? 0)}
            </Badge>
          </li>
          <li className={uiClasses.resourceRow}>
            <div className={uiClasses.resourceRowMain}>
              <p className={uiClasses.resourceTitle}>Уведомления за 24 часа</p>
              <p className={uiClasses.resourceMeta}>
                напоминания {formatNumber(sla?.reminders_sent_24h ?? 0)}
                {' · '}
                повторы {formatNumber(sla?.followups_sent_24h ?? 0)}
                {' · '}
                принято {formatNumber(sla?.received_24h ?? 0)}
              </p>
            </div>
            <Badge tone="neutral">
              пороги {sla?.thresholds.remind_days ?? '—'}/{sla?.thresholds.followup_days ?? '—'}/{sla?.thresholds.admin_alert_days ?? '—'}д
            </Badge>
          </li>
        </ul>
      </Card>
    </Stack>
  );
}

function OutboxSection({
  rows,
  loading,
  onRequeue,
  onRequestCancel,
  onConfirmCancel,
  onClearCancel,
  pendingCancelId,
  detail,
  detailLoading,
  onLoadDetail,
  openPayloadIds,
  onTogglePayload,
  actionsDisabled,
}: {
  rows: AdminOutboxRow[];
  loading: boolean;
  onRequeue: (id: string) => void;
  onRequestCancel: (id: string) => void;
  onConfirmCancel: (id: string) => void;
  onClearCancel: () => void;
  pendingCancelId: string | null;
  detail: AdminOutboxRow | null;
  detailLoading: boolean;
  onLoadDetail: (id: string) => void;
  openPayloadIds: Set<string>;
  onTogglePayload: (id: string) => void;
  actionsDisabled: boolean;
}) {
  return (
    <Card title="Очередь outbox">
      {loading ? <Inline><Spinner /><span className={uiClasses.textMuted}>Загрузка очереди…</span></Inline> : null}
      {!loading && rows.length === 0 ? <EmptyState>Нет строк по выбранным фильтрам.</EmptyState> : null}
      {rows.length ? (
        <ul className={uiClasses.resourceList}>
          {rows.map((row) => (
            <li className={uiClasses.resourceRow} key={row.id}>
              <div className={uiClasses.resourceRowMain}>
                <Inline>
                  <p className={uiClasses.resourceTitle}>{eventLabel(row.event_type)}</p>
                  <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
                  <Badge tone="neutral">{channelLabel(row.channel)}</Badge>
                </Inline>
                <p className={uiClasses.resourceMeta}>
                  {recipientLabel(row.recipient_type)} · {row.recipient_address || row.recipient_id || 'адрес не задан'} · {formatDateTime(row.created_at)}
                  {' · '}
                  код {row.event_type}
                </p>
                <p className={uiClasses.textMuted}>
                  попытки {row.attempt_count}/{row.max_attempts}
                  {row.last_error ? ` · ${row.last_error}` : ''}
                </p>
                {openPayloadIds.has(row.id) ? (
                  <p className={uiClasses.textMuted}>{payloadPreview(row.payload)}</p>
                ) : null}
              </div>
              <Inline>
                <Button
                  variant="ghost"
                  disabled={!row.payload}
                  onClick={() => onTogglePayload(row.id)}
                >
                  {openPayloadIds.has(row.id) ? 'Скрыть данные' : 'Показать данные'}
                </Button>
                <Button
                  variant="ghost"
                  loading={detailLoading}
                  disabled={detailLoading}
                  onClick={() => onLoadDetail(row.id)}
                >
                  Деталь
                </Button>
                <Button
                  variant="secondary"
                  disabled={actionsDisabled || (row.status !== 'failed' && row.status !== 'dead')}
                  onClick={() => onRequeue(row.id)}
                >
                  Вернуть в очередь
                </Button>
                {pendingCancelId === row.id ? (
                  <>
                    <Button
                      variant="danger"
                      disabled={actionsDisabled}
                      onClick={() => onConfirmCancel(row.id)}
                    >
                      Подтвердить отмену
                    </Button>
                    <Button variant="ghost" disabled={actionsDisabled} onClick={onClearCancel}>
                      Оставить
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="danger"
                    disabled={actionsDisabled || (row.status !== 'pending' && row.status !== 'failed')}
                    onClick={() => onRequestCancel(row.id)}
                  >
                    Отменить
                  </Button>
                )}
              </Inline>
            </li>
          ))}
        </ul>
      ) : null}
      {detail ? (
        <Card elevated title="Деталь outbox">
          <Stack>
            <Inline>
              <Badge tone={statusTone(detail.status)}>{statusLabel(detail.status)}</Badge>
              <Badge tone="neutral">{channelLabel(detail.channel)}</Badge>
              <span className={uiClasses.textMuted}>{detail.id}</span>
            </Inline>
            <p className={uiClasses.textMuted}>
              correlation {detail.correlation_id ?? '—'} · attempts {detail.attempt_count}/{detail.max_attempts}
            </p>
            <p className={uiClasses.textMuted}>{payloadPreview(detail.payload)}</p>
            {detail.last_error ? <p className={uiClasses.textMuted}>{detail.last_error}</p> : null}
          </Stack>
        </Card>
      ) : null}
    </Card>
  );
}

function NotificationLogSection({
  rows,
  loading,
  limitMax,
  detail,
  detailLoading,
  onLoadDetail,
}: {
  rows: NotificationLogRow[];
  loading: boolean;
  limitMax: number | null;
  detail: NotificationLogRow | null;
  detailLoading: boolean;
  onLoadDetail: (id: string) => void;
}) {
  return (
    <Card
      title="Лог доставки"
      subtitle={limitMax ? `Серверный лимит выборки: ${formatNumber(limitMax)}` : undefined}
    >
      {loading ? <Inline><Spinner /><span className={uiClasses.textMuted}>Загрузка лога…</span></Inline> : null}
      {!loading && rows.length === 0 ? <EmptyState>Нет событий доставки за выбранное окно.</EmptyState> : null}
      {rows.length ? (
        <ul className={uiClasses.resourceList}>
          {rows.map((row) => (
            <li className={uiClasses.resourceRow} key={row.id}>
              <div className={uiClasses.resourceRowMain}>
                <Inline>
                  <p className={uiClasses.resourceTitle}>{eventLabel(row.event_type)}</p>
                  <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
                  <Badge tone="neutral">{channelLabel(row.channel)}</Badge>
                </Inline>
                <p className={uiClasses.resourceMeta}>
                  {recipientLabel(row.recipient_type)} · {row.recipient_address || row.recipient_id || 'адрес скрыт'} · {formatDateTime(row.created_at)}
                  {' · '}
                  код {row.event_type}
                </p>
                {row.error_code || row.error_message ? (
                  <p className={uiClasses.textMuted}>
                    {row.error_code || 'provider_error'}{row.error_message ? ` · ${row.error_message}` : ''}
                  </p>
                ) : null}
              </div>
              <Inline>
                <Button
                  variant="ghost"
                  loading={detailLoading}
                  disabled={detailLoading}
                  onClick={() => onLoadDetail(row.id)}
                >
                  Деталь
                </Button>
                <Badge tone={row.status === 'sent' ? 'success' : 'warning'}>
                  попытки {formatNumber(row.attempt_count)}
                </Badge>
              </Inline>
            </li>
          ))}
        </ul>
      ) : null}
      {detail ? (
        <Card elevated title="Деталь доставки">
          <Stack>
            <Inline>
              <Badge tone={statusTone(detail.status)}>{statusLabel(detail.status)}</Badge>
              <Badge tone="neutral">{channelLabel(detail.channel)}</Badge>
              <span className={uiClasses.textMuted}>{detail.id}</span>
            </Inline>
            <p className={uiClasses.textMuted}>
              outbox {detail.outbox_id ?? '—'} · provider {detail.provider_message_id ?? '—'}
            </p>
            <p className={uiClasses.textMuted}>{payloadPreview(detail.payload)}</p>
            {detail.error_code || detail.error_message ? (
              <p className={uiClasses.textMuted}>
                {detail.error_code || 'provider_error'}{detail.error_message ? ` · ${detail.error_message}` : ''}
              </p>
            ) : null}
          </Stack>
        </Card>
      ) : null}
    </Card>
  );
}

function KpiTile({
  title,
  value,
  tone = 'neutral',
}: {
  title: string;
  value: number | string;
  tone?: BadgeTone;
}) {
  return (
    <Card>
      <Stack>
        <Inline><Badge tone={tone}>{title}</Badge></Inline>
        <strong className={uiClasses.cardTitle}>
          {typeof value === 'number' ? formatNumber(value) : value}
        </strong>
      </Stack>
    </Card>
  );
}
