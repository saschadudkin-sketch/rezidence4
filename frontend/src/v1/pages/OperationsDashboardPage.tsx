import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, isV1ApiError } from '../api';
import type {
  AnalyticsPeriod,
  OperationsDashboardPeriod,
  OperationsDashboardSnapshot,
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
  Select,
  Spinner,
  Stack,
  uiClasses,
} from '../components/ui';

const PERIODS: Array<{ value: OperationsDashboardPeriod; label: string }> = [
  { value: '24h', label: '24 часа' },
  { value: '7d', label: '7 дней' },
  { value: '30d', label: '30 дней' },
];

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('ru-RU', {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatMinutes(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value < 60) return `${Math.round(value)} мин`;
  const hours = value / 60;
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(hours)} ч`;
}

function formatSeconds(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value < 60) return `${Math.round(value)} сек`;
  return formatMinutes(value / 60);
}

function healthTone(value: number | null): 'success' | 'warning' | 'error' | 'neutral' {
  if (value === null) return 'neutral';
  if (value >= 0.95) return 'success';
  if (value >= 0.85) return 'warning';
  return 'error';
}

export function OperationsDashboardPage() {
  const session = useV1Session();
  const labels = useMemo(() => getPropertyLabels(session.property_type), [session.property_type]);
  const propertyId = session.property_id ?? null;
  const [period, setPeriod] = useState<OperationsDashboardPeriod>('7d');

  const query = useQuery({
    queryKey: ['v1', 'operations-dashboard', propertyId, period],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => {
      if (!propertyId) throw new Error('property_id is missing');
      return api.operationsDashboard.get({ property_id: propertyId, period }, { signal });
    },
  });

  if (!propertyId) {
    return (
      <div className={uiClasses.pageShell}>
        <header className={uiClasses.pageHeader}>
          <h1 className={uiClasses.pageTitle}>Операционный обзор</h1>
        </header>
        <Alert tone="warning">
          Администратор не привязан к объекту.
        </Alert>
      </div>
    );
  }

  const dashboard = query.data?.dashboard ?? null;

  return (
    <div className={uiClasses.pageShell}>
      <header className={uiClasses.pageHeader}>
        <Inline>
          <div>
            <h1 className={uiClasses.pageTitle}>Операционный обзор</h1>
            <p className={uiClasses.pageSubtitle}>
              {labels.propertyKind}: заявки, доступ, инциденты и уведомления.
            </p>
          </div>
        </Inline>
      </header>

      <Stack>
        <Card>
          <Inline>
            <Field id="ops-period" label="Период">
              <Select
                id="ops-period"
                value={period}
                onChange={(e) => setPeriod(e.target.value as OperationsDashboardPeriod)}
              >
                {PERIODS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </Select>
            </Field>
            {dashboard ? (
              <p className={uiClasses.textMuted}>
                Обновлено: {formatDateTime(dashboard.generated_at)}
              </p>
            ) : null}
          </Inline>
        </Card>

        {query.isLoading ? (
          <Card>
            <Inline><Spinner /><span className={uiClasses.textMuted}>Загрузка…</span></Inline>
          </Card>
        ) : null}

        {query.isError ? (
          <Alert tone="error">
            Не удалось загрузить обзор: {isV1ApiError(query.error) ? query.error.message : 'неизвестная ошибка'}
          </Alert>
        ) : null}

        {dashboard ? <DashboardContent dashboard={dashboard} /> : null}
        <AnalyticsDetailPanel propertyId={propertyId} period={period} />
      </Stack>
    </div>
  );
}

function analyticsQueryPeriod(period: OperationsDashboardPeriod): AnalyticsPeriod {
  return period;
}

function DashboardContent({ dashboard }: { dashboard: OperationsDashboardSnapshot }) {
  return (
    <Stack>
      <section className={uiClasses.formGrid} aria-label="Ключевые показатели">
        <KpiTile title="Открыто заявок" value={dashboard.requests.open} />
        <KpiTile
          title="Просроченный backlog"
          value={dashboard.requests.overdue_backlog}
          tone={dashboard.requests.overdue_backlog > 0 ? 'warning' : 'success'}
        />
        <KpiTile title="Проходы и въезды" value={dashboard.access.allow_count} />
        <KpiTile
          title="Оффлайн replay"
          value={dashboard.access.offline_replay_count}
          tone={dashboard.access.offline_replay_count > 0 ? 'warning' : 'success'}
        />
        <KpiTile
          title="Доставка уведомлений"
          value={formatPercent(dashboard.notifications.success_rate)}
          tone={healthTone(dashboard.notifications.success_rate)}
        />
      </section>

      <section className={uiClasses.formGrid} aria-label="Операционные блоки">
        <RequestsPanel dashboard={dashboard} />
        <AccessPanel dashboard={dashboard} />
        <IncidentsPanel dashboard={dashboard} />
        <NotificationsPanel dashboard={dashboard} />
      </section>
    </Stack>
  );
}

function AnalyticsDetailPanel({
  propertyId,
  period,
}: {
  propertyId: string;
  period: OperationsDashboardPeriod;
}) {
  const queryClient = useQueryClient();
  const analyticsPeriod = analyticsQueryPeriod(period);
  const trafficQuery = useQuery({
    queryKey: ['v1', 'analytics', 'traffic', propertyId, period],
    queryFn: ({ signal }) => api.analytics.traffic(
      { granularity: period === '24h' ? 'hour' : 'day' },
      { signal },
    ),
  });
  const topResidentsQuery = useQuery({
    queryKey: ['v1', 'analytics', 'top-residents', propertyId, period],
    queryFn: ({ signal }) => api.analytics.topResidents({ limit: 5 }, { signal }),
  });
  const slaQuery = useQuery({
    queryKey: ['v1', 'analytics', 'sla', propertyId, period],
    queryFn: ({ signal }) => api.analytics.sla(undefined, { signal }),
  });
  const requestsQuery = useQuery({
    queryKey: ['v1', 'analytics', 'requests', propertyId, period],
    queryFn: ({ signal }) => api.analytics.requests(undefined, { signal }),
  });
  const packagesQuery = useQuery({
    queryKey: ['v1', 'analytics', 'packages', propertyId, period],
    queryFn: ({ signal }) => api.analytics.packages(undefined, { signal }),
  });
  const snapshotsQuery = useQuery({
    queryKey: ['v1', 'analytics', 'snapshots', propertyId, period],
    queryFn: ({ signal }) => api.analytics.listSnapshots(
      { property_id: propertyId, period: analyticsPeriod, limit: 5 },
      { signal },
    ),
  });
  const latestSnapshotQuery = useQuery({
    queryKey: ['v1', 'analytics', 'latest-snapshot', propertyId, period],
    queryFn: ({ signal }) => api.analytics.latestSnapshot(
      { property_id: propertyId, period: analyticsPeriod },
      { signal },
    ),
  });
  const createSnapshotMutation = useMutation({
    mutationFn: () => api.analytics.createSnapshot({
      property_id: propertyId,
      period: analyticsPeriod,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['v1', 'analytics'] });
    },
  });

  const traffic = trafficQuery.data ?? null;
  const trafficTotal = traffic?.series.visits.reduce((sum, value) => sum + value, 0) ?? null;
  const topResidents = topResidentsQuery.data?.residents ?? [];
  const slaRows = slaQuery.data?.byType ?? [];
  const requestStatuses = requestsQuery.data
    ? Object.entries(requestsQuery.data.byStatus)
    : [];
  const packageAnalytics = packagesQuery.data ?? null;
  const snapshots = snapshotsQuery.data?.snapshots ?? [];
  const latestSnapshot = latestSnapshotQuery.data?.snapshot ?? null;
  const isLoading = [
    trafficQuery,
    topResidentsQuery,
    slaQuery,
    requestsQuery,
    packagesQuery,
    snapshotsQuery,
    latestSnapshotQuery,
  ].some((query) => query.isLoading);
  const error = [
    trafficQuery,
    topResidentsQuery,
    slaQuery,
    requestsQuery,
    packagesQuery,
    snapshotsQuery,
    latestSnapshotQuery,
  ].find((query) => query.isError)?.error;

  return (
    <Card
      title="Детальная аналитика"
      subtitle="Traffic, SLA, заявки, посылки и аналитические snapshots."
      actions={(
        <Button
          variant="secondary"
          loading={createSnapshotMutation.isPending}
          onClick={() => createSnapshotMutation.mutate()}
        >
          Создать snapshot
        </Button>
      )}
    >
      <Stack>
        {isLoading ? (
          <Inline><Spinner /><span className={uiClasses.textMuted}>Загрузка аналитики…</span></Inline>
        ) : null}
        {error ? (
          <Alert tone="error">
            Не удалось загрузить аналитику: {isV1ApiError(error) ? error.message : 'неизвестная ошибка'}
          </Alert>
        ) : null}
        {createSnapshotMutation.isError ? (
          <Alert tone="error">
            Не удалось создать snapshot: {isV1ApiError(createSnapshotMutation.error) ? createSnapshotMutation.error.message : 'неизвестная ошибка'}
          </Alert>
        ) : null}
        {createSnapshotMutation.isSuccess ? (
          <Alert tone="success">Snapshot создан.</Alert>
        ) : null}

        <section className={uiClasses.formGrid} aria-label="Детальные метрики аналитики">
          <KpiTile title="Traffic visits" value={trafficTotal ?? '—'} />
          <KpiTile title="Посылки ожидают" value={packageAnalytics?.pending ?? '—'} />
          <KpiTile title="Посылки получены" value={packageAnalytics?.received ?? '—'} />
          <KpiTile
            title="Средняя выдача"
            value={packageAnalytics ? formatMinutes(packageAnalytics.avg_pickup_hours === null ? null : packageAnalytics.avg_pickup_hours * 60) : '—'}
          />
        </section>

        <section className={uiClasses.formGrid} aria-label="Аналитические разрезы">
          <Card title="SLA по типам">
            {slaRows.length ? (
              <ul className={uiClasses.resourceList}>
                {slaRows.map((row) => (
                  <li className={uiClasses.resourceRow} key={row.type}>
                    <div className={uiClasses.resourceRowMain}>
                      <p className={uiClasses.resourceTitle}>{row.type}</p>
                      <p className={uiClasses.resourceMeta}>
                        {formatNumber(row.within_sla)} в SLA · {formatNumber(row.overdue)} просрочено
                      </p>
                    </div>
                    <Badge>{formatNumber(row.total)}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState>Нет SLA-данных за период.</EmptyState>
            )}
          </Card>

          <Card title="Статусы заявок">
            {requestStatuses.length ? (
              <ul className={uiClasses.resourceList}>
                {requestStatuses.map(([status, total]) => (
                  <li className={uiClasses.resourceRow} key={status}>
                    <div className={uiClasses.resourceRowMain}>
                      <p className={uiClasses.resourceTitle}>{status}</p>
                    </div>
                    <Badge>{formatNumber(total)}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState>Нет заявок за период.</EmptyState>
            )}
          </Card>

          <Card title="Активные жители">
            {topResidents.length ? (
              <ul className={uiClasses.resourceList}>
                {topResidents.map((resident) => (
                  <li className={uiClasses.resourceRow} key={resident.uid}>
                    <div className={uiClasses.resourceRowMain}>
                      <p className={uiClasses.resourceTitle}>{resident.name ?? resident.uid}</p>
                      <p className={uiClasses.resourceMeta}>
                        {resident.apartment ?? 'без квартиры'} · {formatNumber(resident.pass_count)} пропусков
                      </p>
                    </div>
                    <Badge>{formatNumber(resident.guest_count)}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState>Нет активности жителей.</EmptyState>
            )}
          </Card>

          <Card
            title="Snapshots"
            subtitle={latestSnapshot?.generated_at ? `Последний: ${formatDateTime(latestSnapshot.generated_at)}` : undefined}
          >
            {snapshots.length ? (
              <ul className={uiClasses.resourceList}>
                {snapshots.map((snapshot) => (
                  <li className={uiClasses.resourceRow} key={snapshot.id}>
                    <div className={uiClasses.resourceRowMain}>
                      <p className={uiClasses.resourceTitle}>{snapshot.metric_group ?? 'analytics'}</p>
                      <p className={uiClasses.resourceMeta}>
                        {snapshot.generated_at ? formatDateTime(snapshot.generated_at) : 'без даты'}
                      </p>
                    </div>
                    <Badge>{snapshot.period}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState>Snapshots еще не создавались.</EmptyState>
            )}
          </Card>
        </section>
      </Stack>
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
  tone?: 'success' | 'warning' | 'error' | 'neutral';
}) {
  return (
    <Card>
      <Stack>
        <Inline>
          <Badge tone={tone}>{title}</Badge>
        </Inline>
        <strong className={uiClasses.cardTitle}>
          {typeof value === 'number' ? formatNumber(value) : value}
        </strong>
      </Stack>
    </Card>
  );
}

function RequestsPanel({ dashboard }: { dashboard: OperationsDashboardSnapshot }) {
  return (
    <Card
      title="Заявки"
      subtitle={`${formatNumber(dashboard.requests.created)} создано, ${formatNumber(dashboard.requests.completed)} закрыто`}
    >
      <dl className={uiClasses.staffMetaGrid}>
        <Metric label="SLA" value={formatPercent(dashboard.requests.sla_compliance_rate)} />
        <Metric label="Первый ответ" value={formatMinutes(dashboard.requests.first_response_median_minutes)} />
        <Metric label="Решение" value={formatMinutes(dashboard.requests.resolution_median_minutes)} />
      </dl>
      <BreakdownList
        empty="Нет статусов заявок."
        rows={dashboard.requests.by_status}
        labelKey="status"
      />
    </Card>
  );
}

function AccessPanel({ dashboard }: { dashboard: OperationsDashboardSnapshot }) {
  return (
    <Card
      title="Доступ"
      subtitle={`${formatNumber(dashboard.access.requests_created)} заявок за период`}
    >
      <dl className={uiClasses.staffMetaGrid}>
        <Metric label="Одобрение" value={formatPercent(dashboard.access.approval_rate)} />
        <Metric label="Отказы" value={formatNumber(dashboard.access.denial_count)} />
        <Metric label="Авто" value={formatNumber(dashboard.access.vehicle_traffic_count)} />
        <Metric label="Manual override" value={formatNumber(dashboard.access.manual_override_count)} />
        <Metric label="Среднее решение" value={formatSeconds(dashboard.access.avg_decision_seconds)} />
        <Metric label="СКУД ошибки" value={formatNumber(dashboard.access.skud_failed_events)} />
      </dl>
      <ul className={uiClasses.resourceList}>
        <SimpleRow label="Активные пропуска" value={dashboard.access.active_passes} />
        <SimpleRow label="Ожидают решения" value={dashboard.access.pending} />
        <SimpleRow label="Истекли" value={dashboard.access.expired} />
        <SimpleRow label="Trusted visitors" value={dashboard.access.trusted_visitors_active} />
        <SimpleRow label="Trusted visitor passes" value={dashboard.access.trusted_visitor_passes_created} />
        <SimpleRow label="Manual-control СКУД" value={dashboard.access.skud_manual_control_count} />
      </ul>
      <AccessPointBreakdown rows={dashboard.access.by_access_point} />
      <BreakdownList
        empty="Нет deny reasons за период."
        rows={dashboard.access.deny_reasons}
        labelKey="reason"
      />
      <BreakdownList
        empty="Нет manual override за период."
        rows={dashboard.access.manual_overrides_by_type}
        labelKey="override_type"
      />
      <BreakdownList
        empty="Нет offline replay за период."
        rows={dashboard.access.offline_replay_by_status}
        labelKey="replay_status"
      />
      <BreakdownList
        empty="Нет пиковых окон за период."
        rows={dashboard.access.peak_traffic_windows}
        labelKey="window_start"
      />
    </Card>
  );
}

function AccessPointBreakdown({
  rows,
}: {
  rows: OperationsDashboardSnapshot['access']['by_access_point'];
}) {
  if (!rows.length) return <EmptyState>Нет событий по КПП за период.</EmptyState>;
  return (
    <ul className={uiClasses.resourceList}>
      {rows.map((row) => (
        <li className={uiClasses.resourceRow} key={row.access_point_id || row.name}>
          <div className={uiClasses.resourceRowMain}>
            <p className={uiClasses.resourceTitle}>{row.name}</p>
            <p className={uiClasses.resourceMeta}>
              {formatNumber(row.allow_count)} allow · {formatNumber(row.denial_count)} deny
            </p>
          </div>
          <Badge>{formatNumber(row.total)}</Badge>
        </li>
      ))}
    </ul>
  );
}

function IncidentsPanel({ dashboard }: { dashboard: OperationsDashboardSnapshot }) {
  const openTotal = dashboard.incidents.open + dashboard.incidents.investigating;
  return (
    <Card
      title="Инциденты"
      subtitle={`${formatNumber(openTotal)} в работе, ${formatNumber(dashboard.incidents.closed)} закрыто`}
    >
      <dl className={uiClasses.staffMetaGrid}>
        <Metric label="Высокий риск" value={formatNumber(dashboard.incidents.high_priority_open)} />
        <Metric label="Blacklist" value={formatNumber(dashboard.incidents.blacklist_hits)} />
        <Metric label="Повторные попытки" value={formatNumber(dashboard.incidents.suspicious_attempts)} />
        <Metric label="Медиана" value={formatMinutes(dashboard.incidents.resolution_median_minutes)} />
      </dl>
      <BreakdownList
        empty="Нет инцидентов за период."
        rows={dashboard.incidents.by_type}
        labelKey="incident_type"
      />
    </Card>
  );
}

function NotificationsPanel({ dashboard }: { dashboard: OperationsDashboardSnapshot }) {
  const queue = dashboard.notifications.queue;
  return (
    <Card
      title="Уведомления"
      subtitle={`${formatNumber(dashboard.notifications.sent)} доставлено, ${formatNumber(dashboard.notifications.failed)} ошибок`}
    >
      <dl className={uiClasses.staffMetaGrid}>
        <Metric label="В ожидании" value={formatNumber(queue.pending)} />
        <Metric label="Ошибки" value={formatNumber(queue.failed)} />
        <Metric label="Dead-letter" value={formatNumber(queue.dead)} />
      </dl>
      {dashboard.notifications.per_channel.length ? (
        <ul className={uiClasses.resourceList}>
          {dashboard.notifications.per_channel.map((row) => (
            <li className={uiClasses.resourceRow} key={row.channel}>
              <div className={uiClasses.resourceRowMain}>
                <p className={uiClasses.resourceTitle}>{row.channel}</p>
                <p className={uiClasses.resourceMeta}>
                  {formatNumber(row.sent)} sent · {formatNumber(row.failed)} failed
                </p>
              </div>
              <Badge tone={healthTone(row.success_rate)}>{formatPercent(row.success_rate)}</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>Нет доставок за период.</EmptyState>
      )}
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function SimpleRow({ label, value }: { label: string; value: number }) {
  return (
    <li className={uiClasses.resourceRow}>
      <div className={uiClasses.resourceRowMain}>
        <p className={uiClasses.resourceTitle}>{label}</p>
      </div>
      <Badge>{formatNumber(value)}</Badge>
    </li>
  );
}

function BreakdownList<K extends string>({
  rows,
  labelKey,
  empty,
}: {
  rows: Array<{ total: number } & Record<K, string>>;
  labelKey: K;
  empty: string;
}) {
  if (!rows.length) return <EmptyState>{empty}</EmptyState>;
  return (
    <ul className={uiClasses.resourceList}>
      {rows.map((row) => (
        <li className={uiClasses.resourceRow} key={row[labelKey]}>
          <div className={uiClasses.resourceRowMain}>
            <p className={uiClasses.resourceTitle}>{row[labelKey]}</p>
          </div>
          <Badge>{formatNumber(row.total)}</Badge>
        </li>
      ))}
    </ul>
  );
}
