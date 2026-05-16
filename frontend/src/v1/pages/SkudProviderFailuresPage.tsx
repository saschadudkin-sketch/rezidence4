import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, isV1ApiError } from '../api';
import type {
  SkudHealthStatus,
  SkudProviderFailureDashboard,
  SkudProviderFailureRow,
} from '../api';
import { useV1Session } from '../store';
import { getPropertyLabels } from '../lib/propertyLabels';
import { formatDateTime } from '../components/formatters';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Field,
  Inline,
  Select,
  Spinner,
  Stack,
  uiClasses,
} from '../components/ui';
import type { BadgeTone } from '../components/ui';

const WINDOW_OPTIONS = [
  { value: 24, label: '24 часа' },
  { value: 72, label: '72 часа' },
  { value: 168, label: '7 дней' },
  { value: 720, label: '30 дней' },
] as const;

const REASON_LABELS: Record<string, string> = {
  provider_down: 'Провайдер недоступен',
  provider_degraded: 'Провайдер деградирует',
  failed_events: 'Ошибки обмена',
  retrying_events: 'Повторные попытки',
  dead_lettered_events: 'Неразобранные ошибки',
  out_of_service_devices: 'Устройства вне работы',
  manual_control_events: 'Ручное управление',
};

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}

function healthTone(status: SkudHealthStatus, needsAttention: boolean): BadgeTone {
  if (status === 'down') return 'error';
  if (status === 'degraded' || needsAttention) return 'warning';
  if (status === 'healthy') return 'success';
  return 'neutral';
}

function healthLabel(status: SkudHealthStatus): string {
  const labels: Record<SkudHealthStatus, string> = {
    unknown: 'Неизвестно',
    healthy: 'Исправен',
    degraded: 'Деградирует',
    down: 'Недоступен',
  };
  return labels[status] ?? status;
}

export function SkudProviderFailuresPage() {
  const session = useV1Session();
  const labels = useMemo(() => getPropertyLabels(session.property_type), [session.property_type]);
  const propertyId = session.property_id ?? null;
  const [windowHours, setWindowHours] = useState<number>(24);

  const query = useQuery({
    queryKey: ['v1', 'skud-provider-failures', propertyId, windowHours],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.skudIntegrations.getProviderFailures({
      property_id: propertyId ?? undefined,
      window_hours: windowHours,
      limit: 50,
    }, { signal }),
  });

  if (!propertyId) {
    return (
      <div className={uiClasses.pageShell}>
        <header className={uiClasses.pageHeader}>
          <h1 className={uiClasses.pageTitle}>СКУД: отказы провайдеров</h1>
        </header>
        <Alert tone="warning">Администратор не привязан к объекту.</Alert>
      </div>
    );
  }

  const dashboard = query.data?.dashboard ?? null;

  return (
    <div className={uiClasses.pageShell}>
      <header className={uiClasses.pageHeader}>
        <h1 className={uiClasses.pageTitle}>СКУД: отказы провайдеров</h1>
        <p className={uiClasses.pageSubtitle}>
          {labels.propertyKind}: провайдеры, события обмена, устройства и ручные действия.
        </p>
      </header>

      <Stack>
        <Card>
          <Inline>
            <Field id="skud-window" label="Окно">
              <Select
                id="skud-window"
                value={windowHours}
                onChange={(event) => setWindowHours(Number(event.target.value))}
              >
                {WINDOW_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
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
            Не удалось загрузить дашборд СКУД: {isV1ApiError(query.error) ? query.error.message : 'неизвестная ошибка'}
          </Alert>
        ) : null}

        {dashboard ? <DashboardContent dashboard={dashboard} /> : null}
      </Stack>
    </div>
  );
}

function DashboardContent({ dashboard }: { dashboard: SkudProviderFailureDashboard }) {
  return (
    <Stack>
      <section className={uiClasses.formGrid} aria-label="Ключевые показатели СКУД">
        <KpiTile
          title="Требуют внимания"
          value={dashboard.summary.providers_needing_attention}
          tone={dashboard.summary.providers_needing_attention > 0 ? 'warning' : 'success'}
        />
        <KpiTile
          title="Ошибки"
          value={dashboard.summary.failed_events}
          tone={dashboard.summary.failed_events > 0 ? 'error' : 'success'}
        />
        <KpiTile
          title="Повтор / dead-letter"
          value={dashboard.summary.retrying_events + dashboard.summary.dead_lettered_events}
          tone={dashboard.summary.retrying_events + dashboard.summary.dead_lettered_events > 0 ? 'warning' : 'success'}
        />
        <KpiTile
          title="Ручные действия"
          value={dashboard.summary.manual_control_events}
          tone={dashboard.summary.manual_control_events > 0 ? 'info' : 'neutral'}
        />
      </section>

      <ProviderList rows={dashboard.providers} />
      <EvidencePanel dashboard={dashboard} />
    </Stack>
  );
}

function KpiTile({
  title,
  value,
  tone = 'neutral',
}: {
  title: string;
  value: number;
  tone?: BadgeTone;
}) {
  return (
    <Card>
      <Stack>
        <Inline><Badge tone={tone}>{title}</Badge></Inline>
        <strong className={uiClasses.cardTitle}>{formatNumber(value)}</strong>
      </Stack>
    </Card>
  );
}

function ProviderList({ rows }: { rows: SkudProviderFailureRow[] }) {
  if (!rows.length) {
    return (
      <Card title="Провайдеры">
        <EmptyState>Нет настроенных SKUD-провайдеров.</EmptyState>
      </Card>
    );
  }

  return (
    <Card title="Провайдеры">
      <ul className={uiClasses.resourceList}>
        {rows.map((row) => (
          <ProviderRow key={row.provider_config.id} row={row} />
        ))}
      </ul>
    </Card>
  );
}

function ProviderRow({ row }: { row: SkudProviderFailureRow }) {
  const provider = row.provider_config;
  const events = row.event_summary;
  const devices = row.device_summary;
  const manual = row.manual_control_summary;
  return (
    <li className={uiClasses.resourceRow}>
      <div className={uiClasses.resourceRowMain}>
        <Inline>
          <p className={uiClasses.resourceTitle}>{provider.display_name}</p>
          <Badge tone={healthTone(provider.health_status, row.needs_attention)}>
            {healthLabel(provider.health_status)}
          </Badge>
        </Inline>
        <p className={uiClasses.resourceMeta}>
          {provider.provider} · {provider.status} · {provider.sync_mode}
          {provider.last_failure_at ? ` · последняя ошибка ${formatDateTime(provider.last_failure_at)}` : ''}
        </p>
        {provider.last_error ? (
          <p className={uiClasses.textMuted}>Ошибка: {provider.last_error}</p>
        ) : null}

        {row.attention_reasons.length ? (
          <Inline>
            {row.attention_reasons.map((reason) => (
              <Badge key={reason} tone="warning">{REASON_LABELS[reason] ?? reason}</Badge>
            ))}
          </Inline>
        ) : null}

        {row.top_errors.length ? (
          <ul className={uiClasses.resourceList} aria-label={`Ошибки ${provider.display_name}`}>
            {row.top_errors.map((error) => (
              <li className={uiClasses.resourceRow} key={`${provider.id}-${error.error_code}`}>
                <div className={uiClasses.resourceRowMain}>
                  <p className={uiClasses.resourceTitle}>{error.error_code}</p>
                  <p className={uiClasses.resourceMeta}>
                    {error.error_message || 'Без сообщения'} · {formatDateTime(error.last_seen_at)}
                  </p>
                </div>
                <Badge tone="error">{formatNumber(error.total)}</Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <dl className={uiClasses.staffMetaGrid}>
        <Metric label="События" value={formatNumber(events.total_events)} />
        <Metric label="Ошибки" value={formatNumber(events.failed_events)} />
        <Metric label="Повтор" value={formatNumber(events.retrying_events)} />
        <Metric label="Dead-letter" value={formatNumber(events.dead_lettered_events)} />
        <Metric label="Устройства" value={formatNumber(devices.total_devices)} />
        <Metric label="Вне работы" value={formatNumber(devices.out_of_service_devices)} />
        <Metric label="Ручной пост" value={formatNumber(devices.manual_guard_devices)} />
        <Metric label="Fail-closed" value={formatNumber(devices.fail_closed_devices)} />
        <Metric label="Ручные события" value={formatNumber(manual.manual_control_events)} />
      </dl>
    </li>
  );
}

function EvidencePanel({ dashboard }: { dashboard: SkudProviderFailureDashboard }) {
  const evidence = dashboard.field_rollout_evidence;
  return (
    <Card
      title="Подтверждение полевого запуска"
      subtitle={`${formatNumber(evidence.returned_provider_configs)} провайдеров, ${formatNumber(evidence.real_failure_rows)} строк ошибок`}
    >
      <dl className={uiClasses.staffMetaGrid}>
        <Metric label="Окно" value={`${formatNumber(evidence.evidence_window_hours)} ч`} />
        <Metric label="Активные провайдеры" value={formatNumber(evidence.active_provider_configs)} />
        <Metric label="Ручные строки" value={formatNumber(evidence.manual_control_event_rows)} />
      </dl>
      <p className={uiClasses.resourceMeta}>
        Таблицы: {evidence.source_tables.join(', ')}
      </p>
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
