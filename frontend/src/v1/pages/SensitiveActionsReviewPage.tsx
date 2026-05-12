import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, isV1ApiError } from '../api';
import type {
  SensitiveActionAntiAbuseFinding,
  SensitiveActionAuditRow,
  SensitiveActionReviewSummary,
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

const FLAG_LABELS: Record<string, string> = {
  high_volume: 'Высокий объём',
  high_risk_category: 'Высокий риск',
  off_hours: 'Ночное окно',
  overdue_reviews: 'Просрочено',
};

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}

function priorityTone(priority: string): BadgeTone {
  if (priority === 'urgent') return 'error';
  if (priority === 'high') return 'warning';
  if (priority === 'normal') return 'info';
  return 'neutral';
}

function statusTone(status: string, overdue = false): BadgeTone {
  if (status === 'approved' || status === 'dismissed') return 'success';
  if (status === 'needs_followup' || overdue) return 'warning';
  return 'neutral';
}

export function SensitiveActionsReviewPage() {
  const session = useV1Session();
  const labels = useMemo(() => getPropertyLabels(session.property_type), [session.property_type]);
  const propertyId = session.property_id ?? null;
  const [category, setCategory] = useState<string>('');
  const [windowHours, setWindowHours] = useState<number>(168);

  const commonParams = {
    property_id: propertyId ?? undefined,
    category: category || undefined,
  };

  const metaQuery = useQuery({
    queryKey: ['v1', 'sensitive-actions-meta'],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.auditReviews.meta({ signal }),
  });
  const summaryQuery = useQuery({
    queryKey: ['v1', 'sensitive-actions-summary', propertyId, category],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.auditReviews.summary(commonParams, { signal }),
  });
  const antiAbuseQuery = useQuery({
    queryKey: ['v1', 'sensitive-actions-anti-abuse', propertyId, category, windowHours],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.auditReviews.antiAbuse({
      ...commonParams,
      window_hours: windowHours,
      min_actions: 5,
      limit: 20,
    }, { signal }),
  });
  const pendingQuery = useQuery({
    queryKey: ['v1', 'sensitive-actions-pending', propertyId, category],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.auditReviews.list({
      ...commonParams,
      review_status: 'pending',
      limit: 20,
    }, { signal }),
  });

  if (!propertyId) {
    return (
      <div className={uiClasses.pageShell}>
        <header className={uiClasses.pageHeader}>
          <h1 className={uiClasses.pageTitle}>Sensitive action review</h1>
        </header>
        <Alert tone="warning">Администратор не привязан к объекту.</Alert>
      </div>
    );
  }

  const summary = summaryQuery.data?.summary ?? null;
  const analytics = antiAbuseQuery.data?.analytics ?? null;
  const pendingRows = pendingQuery.data?.actions ?? [];
  const categories = metaQuery.data?.categories ?? [];
  const isLoading = summaryQuery.isLoading || antiAbuseQuery.isLoading || pendingQuery.isLoading;
  const error = summaryQuery.error || antiAbuseQuery.error || pendingQuery.error || metaQuery.error;

  return (
    <div className={uiClasses.pageShell}>
      <header className={uiClasses.pageHeader}>
        <h1 className={uiClasses.pageTitle}>Sensitive action review</h1>
        <p className={uiClasses.pageSubtitle}>
          {labels.propertyKind}: отчёт по audit review, SLA и anti-abuse сигналам.
        </p>
      </header>

      <Stack>
        <Card>
          <Inline>
            <Field id="sensitive-category" label="Категория">
              <Select
                id="sensitive-category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="">Все категории</option>
                {categories.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </Select>
            </Field>
            <Field id="sensitive-window" label="Anti-abuse окно">
              <Select
                id="sensitive-window"
                value={windowHours}
                onChange={(event) => setWindowHours(Number(event.target.value))}
              >
                {WINDOW_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </Field>
          </Inline>
        </Card>

        {isLoading ? (
          <Card>
            <Inline><Spinner /><span className={uiClasses.textMuted}>Загрузка…</span></Inline>
          </Card>
        ) : null}

        {error ? (
          <Alert tone="error">
            Не удалось загрузить review report: {isV1ApiError(error) ? error.message : 'неизвестная ошибка'}
          </Alert>
        ) : null}

        {summary ? <SummarySection summary={summary} /> : null}
        {analytics ? <AntiAbuseSection rows={analytics.findings} /> : null}
        <PendingReviewSection rows={pendingRows} />
      </Stack>
    </div>
  );
}

function SummarySection({ summary }: { summary: SensitiveActionReviewSummary }) {
  const pending = summary.totals.by_status.pending ?? 0;
  const urgent = summary.totals.by_priority.urgent ?? 0;
  const high = summary.totals.by_priority.high ?? 0;
  return (
    <Stack>
      <section className={uiClasses.formGrid} aria-label="Sensitive review KPIs">
        <KpiTile title="Всего" value={summary.totals.total} />
        <KpiTile
          title="Pending"
          value={pending}
          tone={pending > 0 ? 'warning' : 'success'}
        />
        <KpiTile
          title="Overdue"
          value={summary.totals.overdue}
          tone={summary.totals.overdue > 0 ? 'error' : 'success'}
        />
        <KpiTile
          title="Urgent / high"
          value={urgent + high}
          tone={urgent + high > 0 ? 'warning' : 'neutral'}
        />
      </section>

      <Card title="Статусы и приоритеты">
        {summary.rows.length ? (
          <ul className={uiClasses.resourceList}>
            {summary.rows.map((row) => (
              <li className={uiClasses.resourceRow} key={`${row.review_status}-${row.priority}`}>
                <div className={uiClasses.resourceRowMain}>
                  <p className={uiClasses.resourceTitle}>{row.review_status}</p>
                  <p className={uiClasses.resourceMeta}>
                    priority {row.priority} · overdue {formatNumber(row.overdue)}
                  </p>
                </div>
                <Badge tone={priorityTone(row.priority)}>{formatNumber(row.total)}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>Нет sensitive audit rows.</EmptyState>
        )}
      </Card>
    </Stack>
  );
}

function AntiAbuseSection({ rows }: { rows: SensitiveActionAntiAbuseFinding[] }) {
  return (
    <Card title="Anti-abuse findings">
      {rows.length ? (
        <ul className={uiClasses.resourceList}>
          {rows.map((row) => (
            <li className={uiClasses.resourceRow} key={`${row.actor_uid ?? 'unknown'}-${row.category}`}>
              <div className={uiClasses.resourceRowMain}>
                <p className={uiClasses.resourceTitle}>{row.actor_uid || 'unknown actor'}</p>
                <p className={uiClasses.resourceMeta}>
                  {row.actor_role || 'role unknown'} · {row.category} · risk {formatNumber(row.risk_score)}
                </p>
                <Inline>
                  {row.flags.map((flag) => (
                    <Badge key={flag} tone={flag === 'overdue_reviews' ? 'error' : 'warning'}>
                      {FLAG_LABELS[flag] ?? flag}
                    </Badge>
                  ))}
                </Inline>
              </div>
              <dl className={uiClasses.staffMetaGrid}>
                <Metric label="Actions" value={formatNumber(row.total_actions)} />
                <Metric label="High risk" value={formatNumber(row.high_risk_actions)} />
                <Metric label="Off-hours" value={formatNumber(row.off_hours_actions)} />
              </dl>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>Нет anti-abuse findings в выбранном окне.</EmptyState>
      )}
    </Card>
  );
}

function PendingReviewSection({ rows }: { rows: SensitiveActionAuditRow[] }) {
  return (
    <Card title="Pending review queue">
      {rows.length ? (
        <ul className={uiClasses.resourceList}>
          {rows.map((row) => (
            <li className={uiClasses.resourceRow} key={row.id}>
              <div className={uiClasses.resourceRowMain}>
                <Inline>
                  <p className={uiClasses.resourceTitle}>{row.canonical_event_type}</p>
                  <Badge tone={statusTone(row.review.status, row.review.assignment.overdue)}>
                    {row.review.status}
                  </Badge>
                  <Badge tone={priorityTone(row.review.assignment.priority)}>
                    {row.review.assignment.priority}
                  </Badge>
                </Inline>
                <p className={uiClasses.resourceMeta}>
                  {row.category} · actor {row.actor_uid || 'unknown'} · {formatDateTime(row.created_at)}
                </p>
                <p className={uiClasses.textMuted}>
                  Due: {formatDateTime(row.review.assignment.due_at)} · Escalation: {row.review.assignment.escalation_status}
                </p>
              </div>
              <Badge tone={row.review.assignment.overdue ? 'error' : 'neutral'}>
                {row.review.assignment.overdue ? 'overdue' : 'open'}
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>Нет pending review items.</EmptyState>
      )}
    </Card>
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
