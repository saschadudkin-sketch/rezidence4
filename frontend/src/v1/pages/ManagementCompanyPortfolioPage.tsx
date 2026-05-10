import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, isV1ApiError } from '../api';
import type {
  ManagementCompanyPortfolioProperty,
  ManagementCompanyPortfolioRanking,
  ManagementCompanyPortfolioSnapshot,
  OperationsDashboardPeriod,
} from '../api';
import { useV1Session } from '../store';
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

function healthTone(value: number | null | undefined): 'success' | 'warning' | 'error' | 'neutral' {
  if (value === null || value === undefined) return 'neutral';
  if (value >= 0.95) return 'success';
  if (value >= 0.85) return 'warning';
  return 'error';
}

function riskTone(value: number): 'success' | 'warning' | 'error' | 'neutral' {
  if (value <= 0) return 'success';
  if (value <= 2) return 'warning';
  return 'error';
}

function parseSlugDraft(value: string): string[] {
  return [...new Set(
    value
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean),
  )];
}

function hotspotLabel(value: string): string {
  const labels: Record<string, string> = {
    overdue_backlog: 'SLA backlog',
    high_priority_incidents: 'Высокий риск',
    incident_load: 'Инциденты',
    notification_delivery: 'Доставка',
    notification_queue: 'Очередь',
    tenant_unavailable: 'Нет данных',
  };
  return labels[value] ?? value;
}

export function ManagementCompanyPortfolioPage() {
  const session = useV1Session();
  const [period, setPeriod] = useState<OperationsDashboardPeriod>('7d');
  const [draftSlugs, setDraftSlugs] = useState('');
  const [propertySlugs, setPropertySlugs] = useState<string[]>([]);
  const [includeInactive, setIncludeInactive] = useState(false);

  const canLoad = Boolean(session.property_slug || session.property_id);
  const query = useQuery({
    queryKey: [
      'v1',
      'management-company-portfolio',
      session.property_slug,
      period,
      propertySlugs.join(','),
      includeInactive,
    ],
    enabled: canLoad,
    queryFn: ({ signal }) => api.managementCompanyPortfolio.get({
      period,
      propertySlugs,
      includeInactive,
    }, { signal }),
  });

  const portfolio = query.data?.portfolio ?? null;
  const problemCount = portfolio?.rankings.overdue_backlog.length
    || portfolio?.rankings.incident_load.length
    || portfolio?.rankings.notification_failures.length
    || 0;

  if (!canLoad) {
    return (
      <div className={uiClasses.pageShell}>
        <header className={uiClasses.pageHeader}>
          <h1 className={uiClasses.pageTitle}>Портфель УК</h1>
        </header>
        <Alert tone="warning">
          Сессия не привязана к объекту УК.
        </Alert>
      </div>
    );
  }

  return (
    <div className={uiClasses.pageShell}>
      <header className={uiClasses.pageHeader}>
        <h1 className={uiClasses.pageTitle}>Портфель УК</h1>
        <p className={uiClasses.pageSubtitle}>
          Сравнение объектов по заявкам, доступу, инцидентам и уведомлениям.
        </p>
      </header>

      <Stack>
        <Card>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setPropertySlugs(parseSlugDraft(draftSlugs));
            }}
          >
            <div className={uiClasses.formGrid}>
              <Field id="portfolio-period" label="Период">
                <Select
                  id="portfolio-period"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value as OperationsDashboardPeriod)}
                >
                  {PERIODS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </Select>
              </Field>
              <Field
                id="portfolio-slugs"
                label="Фильтр объектов"
                hint="Slug через запятую, пусто = весь портфель"
              >
                <Input
                  id="portfolio-slugs"
                  value={draftSlugs}
                  onChange={(e) => setDraftSlugs(e.target.value)}
                  placeholder="alpha, beta"
                />
              </Field>
              <Field label="Состав портфеля">
                <label className={uiClasses.inline}>
                  <input
                    type="checkbox"
                    checked={includeInactive}
                    onChange={(e) => setIncludeInactive(e.target.checked)}
                  />
                  <span className={uiClasses.textMuted}>Показывать неактивные объекты</span>
                </label>
              </Field>
              <Field label="Действия">
                <Inline>
                  <Button type="submit" variant="secondary">Применить</Button>
                  <Button type="button" variant="ghost" onClick={() => { void query.refetch(); }}>
                    Обновить
                  </Button>
                </Inline>
              </Field>
            </div>
          </form>
          {portfolio ? (
            <p className={uiClasses.textMuted}>
              Обновлено: {formatDateTime(portfolio.generated_at)}
            </p>
          ) : null}
        </Card>

        {query.isLoading ? (
          <Card>
            <Inline><Spinner /><span className={uiClasses.textMuted}>Загрузка портфеля…</span></Inline>
          </Card>
        ) : null}

        {query.isError ? (
          <Alert tone="error">
            Не удалось загрузить портфель: {isV1ApiError(query.error) ? query.error.message : 'неизвестная ошибка'}
          </Alert>
        ) : null}

        {portfolio ? (
          <>
            <section className={uiClasses.formGrid} aria-label="Ключевые показатели портфеля">
              <KpiTile title="Объекты" value={portfolio.rollup.properties_total} />
              <KpiTile
                title="Проблемные объекты"
                value={portfolio.rollup.hotspot_property_count}
                tone={riskTone(portfolio.rollup.hotspot_property_count)}
              />
              <KpiTile
                title="Просроченный backlog"
                value={portfolio.rollup.requests.overdue_backlog}
                tone={riskTone(portfolio.rollup.requests.overdue_backlog)}
              />
              <KpiTile
                title="Доставка уведомлений"
                value={formatPercent(portfolio.rollup.notifications.success_rate)}
                tone={healthTone(portfolio.rollup.notifications.success_rate)}
              />
            </section>

            {portfolio.errors.length ? (
              <Alert tone="warning">
                Недоступно объектов: {formatNumber(portfolio.errors.length)}. Они исключены из агрегированных KPI.
              </Alert>
            ) : null}

            <section className={uiClasses.formGrid} aria-label="Проблемные зоны">
              <RankingCard title="SLA backlog" rows={portfolio.rankings.overdue_backlog} />
              <RankingCard title="Инциденты" rows={portfolio.rankings.incident_load} />
              <RankingCard title="Уведомления" rows={portfolio.rankings.notification_failures} />
              <Card
                title="Rollup"
                subtitle={`SLA ${formatPercent(portfolio.rollup.requests.sla_compliance_rate)} · доступ ${formatPercent(portfolio.rollup.access.approval_rate)}`}
              >
                <dl className={uiClasses.staffMetaGrid}>
                  <Metric label="Открыто заявок" value={formatNumber(portfolio.rollup.requests.open)} />
                  <Metric
                    label="Инциденты"
                    value={formatNumber(portfolio.rollup.incidents.open + portfolio.rollup.incidents.investigating)}
                  />
                  <Metric label="Проходы" value={formatNumber(portfolio.rollup.access.allow_count)} />
                </dl>
              </Card>
            </section>

            <PortfolioProperties portfolio={portfolio} />

            {problemCount === 0 && portfolio.rollup.properties_total > 0 ? (
              <Alert tone="success">
                За выбранный период нет объектов в проблемных списках.
              </Alert>
            ) : null}
          </>
        ) : null}
      </Stack>
    </div>
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

function RankingCard({ title, rows }: { title: string; rows: ManagementCompanyPortfolioRanking[] }) {
  return (
    <Card title={title} subtitle="Первые 5 объектов">
      {rows.length ? (
        <ul className={uiClasses.resourceList}>
          {rows.map((row) => (
            <li className={uiClasses.resourceRow} key={row.property_id}>
              <div className={uiClasses.resourceRowMain}>
                <p className={uiClasses.resourceTitle}>{row.property_name}</p>
                <p className={uiClasses.resourceMeta}>{row.property_slug}</p>
              </div>
              <Badge tone={riskTone(row.value)}>{formatNumber(row.value)}</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>Нет проблемных объектов.</EmptyState>
      )}
    </Card>
  );
}

function PortfolioProperties({ portfolio }: { portfolio: ManagementCompanyPortfolioSnapshot }) {
  const sorted = useMemo(
    () => [...portfolio.properties].sort((a, b) => {
      if (a.health !== b.health) return a.health === 'error' ? -1 : 1;
      return (b.hotspots.length - a.hotspots.length) || a.name.localeCompare(b.name);
    }),
    [portfolio.properties],
  );

  return (
    <Card
      title="Объекты портфеля"
      subtitle={`${formatNumber(portfolio.rollup.properties_healthy)} в расчёте, ${formatNumber(portfolio.rollup.properties_error)} с ошибкой`}
    >
      {sorted.length ? (
        <ul className={uiClasses.resourceList}>
          {sorted.map((property) => (
            <PortfolioPropertyRow key={property.id} property={property} />
          ))}
        </ul>
      ) : (
        <EmptyState>Нет объектов в выбранном портфеле.</EmptyState>
      )}
    </Card>
  );
}

function PortfolioPropertyRow({ property }: { property: ManagementCompanyPortfolioProperty }) {
  const incidentLoad = (property.incidents?.open ?? 0) + (property.incidents?.investigating ?? 0);
  return (
    <li className={uiClasses.resourceRow}>
      <div className={uiClasses.resourceRowMain}>
        <Inline>
          <p className={uiClasses.resourceTitle}>{property.name}</p>
          <Badge tone={property.health === 'ok' ? 'success' : 'error'}>
            {property.health === 'ok' ? 'ok' : 'error'}
          </Badge>
          {!property.is_active ? <Badge tone="warning">inactive</Badge> : null}
        </Inline>
        <p className={uiClasses.resourceMeta}>
          {property.slug}
          {property.generated_at ? ` · ${formatDateTime(property.generated_at)}` : ''}
        </p>
        {property.error ? (
          <p className={uiClasses.textMuted}>{property.error}</p>
        ) : (
          <dl className={`${uiClasses.staffMetaGrid} ${uiClasses.marginTop3}`}>
            <Metric label="Backlog" value={formatNumber(property.requests?.overdue_backlog)} />
            <Metric label="Инциденты" value={formatNumber(incidentLoad)} />
            <Metric label="SLA" value={formatPercent(property.requests?.sla_compliance_rate)} />
          </dl>
        )}
      </div>
      <Stack>
        <Badge tone={healthTone(property.notifications?.success_rate)}>
          {formatPercent(property.notifications?.success_rate)}
        </Badge>
        {property.hotspots.length ? (
          <div className={uiClasses.sectionStack}>
            {property.hotspots.map((hotspot) => (
              <Badge key={hotspot} tone={hotspot === 'tenant_unavailable' ? 'error' : 'warning'}>
                {hotspotLabel(hotspot)}
              </Badge>
            ))}
          </div>
        ) : (
          <Badge tone="success">без риска</Badge>
        )}
      </Stack>
    </li>
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
