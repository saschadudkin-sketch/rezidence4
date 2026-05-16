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
                  <option key={item} value={item}>{item}</option>
                ))}
              </Select>
            </Field>
            <Field id="outbox-status" label="Outbox status">
              <Select
                id="outbox-status"
                value={outboxStatus}
                onChange={(event) => setOutboxStatus(event.target.value as OutboxStatus | '')}
              >
                <option value="">Все</option>
                {OUTBOX_STATUSES.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </Select>
            </Field>
            <Field id="log-status" label="Log status">
              <Select
                id="log-status"
                value={logStatus}
                onChange={(event) => setLogStatus(event.target.value as NotificationLogStatus | '')}
              >
                <option value="">Все</option>
                {LOG_STATUSES.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </Select>
            </Field>
            <Field id="outbox-q" label="Поиск outbox">
              <Input
                id="outbox-q"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="event, correlation, адрес"
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
          openPayloadIds={openPayloadIds}
          onTogglePayload={togglePayload}
          actionsDisabled={requeue.isPending || cancel.isPending}
        />

        <NotificationLogSection
          rows={notificationList.data?.items ?? []}
          loading={notificationList.isLoading}
          limitMax={notificationMeta.data?.limit_max ?? null}
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
        <KpiTile title="Pending" value={outbox?.counts.pending ?? 0} tone={(outbox?.counts.pending ?? 0) > 0 ? 'warning' : 'success'} />
        <KpiTile title="Failed" value={outbox?.counts.failed ?? 0} tone={(outbox?.counts.failed ?? 0) > 0 ? 'warning' : 'success'} />
        <KpiTile title="Dead" value={outbox?.counts.dead ?? 0} tone={(outbox?.counts.dead ?? 0) > 0 ? 'error' : 'success'} />
        <KpiTile title="Success rate" value={formatPercent(successRate)} tone={successRate !== null && successRate < 0.95 ? 'warning' : 'success'} />
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
                  <p className={uiClasses.resourceTitle}>{row.channel}</p>
                  <p className={uiClasses.resourceMeta}>
                    pending {formatNumber(row.pending)} · failed {formatNumber(row.failed)} · dead {formatNumber(row.dead)}
                  </p>
                </div>
                <Badge tone={row.pending + row.failed + row.dead > 0 ? 'warning' : 'success'}>
                  sent {formatNumber(row.sent)}
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
          title="Feature"
          value={health?.feature_enabled ? 'enabled' : 'disabled'}
          tone={health?.feature_enabled ? 'success' : 'warning'}
        />
        <KpiTile
          title="Stuck"
          value={health?.stuck_in_flight ?? 0}
          tone={(health?.stuck_in_flight ?? 0) > 0 ? 'warning' : 'success'}
        />
        <KpiTile
          title="Over 14d"
          value={sla?.awaiting_pickup_over_14d ?? 0}
          tone={(sla?.awaiting_pickup_over_14d ?? 0) > 0 ? 'warning' : 'success'}
        />
        <KpiTile
          title="Admin alerts"
          value={sla?.admin_alerts_sent_24h ?? 0}
          tone={(sla?.admin_alerts_sent_24h ?? 0) > 0 ? 'info' : 'neutral'}
        />
      </section>

      <Card
        title="Outbox recovery"
        subtitle={health?.ts ? `Health обновлён ${formatDateTime(health.ts)}` : undefined}
      >
        <Stack>
          <p className={uiClasses.textMuted}>
            pending {formatNumber(health?.counts.pending ?? 0)} · failed {formatNumber(failedCount)} · dead {formatNumber(deadCount)}
            {' · '}
            oldest pending {health?.oldest_pending_age_seconds === null || health?.oldest_pending_age_seconds === undefined
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
                  Confirm retry failed
                </Button>
                <Button variant="ghost" disabled={actionsDisabled} onClick={onClearRetry}>
                  Keep
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                disabled={actionsDisabled || failedCount === 0}
                onClick={() => onRequestRetry('failed')}
              >
                Retry failed
              </Button>
            )}
            {pendingBulkRetry === 'dead' ? (
              <>
                <Button
                  variant="danger"
                  disabled={actionsDisabled}
                  onClick={() => onConfirmRetry('dead')}
                >
                  Confirm retry dead
                </Button>
                <Button variant="ghost" disabled={actionsDisabled} onClick={onClearRetry}>
                  Keep
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                disabled={actionsDisabled || deadCount === 0}
                onClick={() => onRequestRetry('dead')}
              >
                Retry dead
              </Button>
            )}
          </Inline>
        </Stack>
      </Card>

      <Card
        title="Package notification SLA"
        subtitle={sla?.generated_at ? `SLA обновлён ${formatDateTime(sla.generated_at)}` : undefined}
      >
        <ul className={uiClasses.resourceList}>
          <li className={uiClasses.resourceRow}>
            <div className={uiClasses.resourceRowMain}>
              <p className={uiClasses.resourceTitle}>Посылки ожидают выдачи</p>
              <p className={uiClasses.resourceMeta}>
                всего {formatNumber(sla?.awaiting_pickup_total ?? 0)} · over 7d {formatNumber(sla?.awaiting_pickup_over_7d ?? 0)}
                {' · '}
                over 30d {formatNumber(sla?.awaiting_pickup_over_30d ?? 0)}
              </p>
            </div>
            <Badge tone={(sla?.awaiting_pickup_over_14d ?? 0) > 0 ? 'warning' : 'success'}>
              over 14d {formatNumber(sla?.awaiting_pickup_over_14d ?? 0)}
            </Badge>
          </li>
          <li className={uiClasses.resourceRow}>
            <div className={uiClasses.resourceRowMain}>
              <p className={uiClasses.resourceTitle}>Уведомления за 24 часа</p>
              <p className={uiClasses.resourceMeta}>
                reminders {formatNumber(sla?.reminders_sent_24h ?? 0)}
                {' · '}
                followups {formatNumber(sla?.followups_sent_24h ?? 0)}
                {' · '}
                received {formatNumber(sla?.received_24h ?? 0)}
              </p>
            </div>
            <Badge tone="neutral">
              thresholds {sla?.thresholds.remind_days ?? '—'}/{sla?.thresholds.followup_days ?? '—'}/{sla?.thresholds.admin_alert_days ?? '—'}d
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
  openPayloadIds: Set<string>;
  onTogglePayload: (id: string) => void;
  actionsDisabled: boolean;
}) {
  return (
    <Card title="Outbox queue">
      {loading ? <Inline><Spinner /><span className={uiClasses.textMuted}>Загрузка очереди…</span></Inline> : null}
      {!loading && rows.length === 0 ? <EmptyState>Нет строк по выбранным фильтрам.</EmptyState> : null}
      {rows.length ? (
        <ul className={uiClasses.resourceList}>
          {rows.map((row) => (
            <li className={uiClasses.resourceRow} key={row.id}>
              <div className={uiClasses.resourceRowMain}>
                <Inline>
                  <p className={uiClasses.resourceTitle}>{row.event_type}</p>
                  <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                  <Badge tone="neutral">{row.channel}</Badge>
                </Inline>
                <p className={uiClasses.resourceMeta}>
                  {row.recipient_type} · {row.recipient_address || row.recipient_id || 'адрес не задан'} · {formatDateTime(row.created_at)}
                </p>
                <p className={uiClasses.textMuted}>
                  attempts {row.attempt_count}/{row.max_attempts}
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
                  {openPayloadIds.has(row.id) ? 'Hide payload' : 'Payload'}
                </Button>
                <Button
                  variant="secondary"
                  disabled={actionsDisabled || (row.status !== 'failed' && row.status !== 'dead')}
                  onClick={() => onRequeue(row.id)}
                >
                  Requeue
                </Button>
                {pendingCancelId === row.id ? (
                  <>
                    <Button
                      variant="danger"
                      disabled={actionsDisabled}
                      onClick={() => onConfirmCancel(row.id)}
                    >
                      Confirm cancel
                    </Button>
                    <Button variant="ghost" disabled={actionsDisabled} onClick={onClearCancel}>
                      Keep
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="danger"
                    disabled={actionsDisabled || (row.status !== 'pending' && row.status !== 'failed')}
                    onClick={() => onRequestCancel(row.id)}
                  >
                    Cancel
                  </Button>
                )}
              </Inline>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function NotificationLogSection({
  rows,
  loading,
  limitMax,
}: {
  rows: NotificationLogRow[];
  loading: boolean;
  limitMax: number | null;
}) {
  return (
    <Card
      title="Notification log"
      subtitle={limitMax ? `Серверный лимит выборки: ${formatNumber(limitMax)}` : undefined}
    >
      {loading ? <Inline><Spinner /><span className={uiClasses.textMuted}>Загрузка лога…</span></Inline> : null}
      {!loading && rows.length === 0 ? <EmptyState>Нет delivery-событий за выбранное окно.</EmptyState> : null}
      {rows.length ? (
        <ul className={uiClasses.resourceList}>
          {rows.map((row) => (
            <li className={uiClasses.resourceRow} key={row.id}>
              <div className={uiClasses.resourceRowMain}>
                <Inline>
                  <p className={uiClasses.resourceTitle}>{row.event_type}</p>
                  <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                  <Badge tone="neutral">{row.channel}</Badge>
                </Inline>
                <p className={uiClasses.resourceMeta}>
                  {row.recipient_type} · {row.recipient_address || row.recipient_id || 'адрес скрыт'} · {formatDateTime(row.created_at)}
                </p>
                {row.error_code || row.error_message ? (
                  <p className={uiClasses.textMuted}>
                    {row.error_code || 'provider_error'}{row.error_message ? ` · ${row.error_message}` : ''}
                  </p>
                ) : null}
              </div>
              <Badge tone={row.status === 'sent' ? 'success' : 'warning'}>
                attempts {formatNumber(row.attempt_count)}
              </Badge>
            </li>
          ))}
        </ul>
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
