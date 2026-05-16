import { useQuery } from '@tanstack/react-query';
import { api, isV1ApiError } from '../api';
import type {
  ResidentOffboardingRecord,
  ResidentOffboardingReport,
  ResidentOffboardingVehicleReview,
} from '../api';
import { useV1Session } from '../store';
import { formatDateTime } from '../components/formatters';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Inline,
  Spinner,
  Stack,
  uiClasses,
} from '../components/ui';
import type { BadgeTone } from '../components/ui';

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}

function reviewTone(vehicle: ResidentOffboardingVehicleReview): BadgeTone {
  if (vehicle.is_blacklisted) return 'error';
  if (vehicle.review_required) return 'warning';
  return 'neutral';
}

export function ResidentOffboardingReportPage() {
  const session = useV1Session();
  const propertyId = session.property_id ?? null;

  const query = useQuery({
    queryKey: ['v1', 'resident-offboarding-report', propertyId],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.residents.offboardingReport({
      property_id: propertyId ?? '',
      limit: 25,
    }, { signal }),
  });

  if (!propertyId) {
    return (
      <div className={uiClasses.pageShell}>
        <header className={uiClasses.pageHeader}>
          <h1 className={uiClasses.pageTitle}>Вывод резидентов</h1>
        </header>
        <Alert tone="warning">Администратор не привязан к объекту.</Alert>
      </div>
    );
  }

  const report = query.data?.report ?? null;

  return (
    <div className={uiClasses.pageShell}>
      <header className={uiClasses.pageHeader}>
        <h1 className={uiClasses.pageTitle}>Вывод резидентов</h1>
        <p className={uiClasses.pageSubtitle}>
          Подтверждения смены собственника, отозванные доступы и очередь проверки автомобилей.
        </p>
      </header>

      <Stack>
        {query.isLoading ? (
          <Card>
            <Inline><Spinner /><span className={uiClasses.textMuted}>Загрузка…</span></Inline>
          </Card>
        ) : null}

        {query.isError ? (
          <Alert tone="error">
            Не удалось загрузить offboarding report: {isV1ApiError(query.error) ? query.error.message : 'неизвестная ошибка'}
          </Alert>
        ) : null}

        {report ? <ReportContent report={report} /> : null}
      </Stack>
    </div>
  );
}

function ReportContent({ report }: { report: ResidentOffboardingReport }) {
  return (
    <Stack>
      <section className={uiClasses.formGrid} aria-label="Показатели вывода резидентов">
        <KpiTile title="Выведено" value={report.summary.offboarded_residents} />
        <KpiTile title="За 30 дней" value={report.summary.offboarded_last_30d} />
        <KpiTile
          title="Проверка авто"
          value={report.summary.vehicles_pending_review}
          tone={report.summary.vehicles_pending_review > 0 ? 'warning' : 'success'}
        />
        <KpiTile title="Недавние записи" value={report.summary.recent_offboarding_rows} />
      </section>

      <RecentOffboardings rows={report.recent_offboardings} />
      <VehicleReviewQueue rows={report.vehicle_review_queue} />
      <EvidencePanel report={report} />
    </Stack>
  );
}

function RecentOffboardings({ rows }: { rows: ResidentOffboardingRecord[] }) {
  return (
    <Card title="Недавний вывод">
      {rows.length ? (
        <ul className={uiClasses.resourceList}>
          {rows.map((row) => (
            <li className={uiClasses.resourceRow} key={row.id}>
              <div className={uiClasses.resourceRowMain}>
                <p className={uiClasses.resourceTitle}>{row.resident_name || row.resident_id}</p>
                <p className={uiClasses.resourceMeta}>
                  {row.reason || 'причина не указана'} · {formatDateTime(row.created_at)} · инициатор {row.actor_uid || 'неизвестен'}
                </p>
              </div>
              <dl className={uiClasses.staffMetaGrid}>
                <Metric label="Пропуска" value={formatNumber(row.summary.revoked_passes)} />
                <Metric label="Заявки" value={formatNumber(row.summary.cancelled_access_requests)} />
                <Metric label="Авто" value={formatNumber(row.summary.vehicles_marked_for_review)} />
              </dl>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>Нет offboarding событий.</EmptyState>
      )}
    </Card>
  );
}

function VehicleReviewQueue({ rows }: { rows: ResidentOffboardingVehicleReview[] }) {
  return (
    <Card title="Очередь проверки авто">
      {rows.length ? (
        <ul className={uiClasses.resourceList}>
          {rows.map((vehicle) => (
            <li className={uiClasses.resourceRow} key={vehicle.id}>
              <div className={uiClasses.resourceRowMain}>
                <p className={uiClasses.resourceTitle}>{vehicle.plate_number}</p>
                <p className={uiClasses.resourceMeta}>
                  {vehicle.offboarding_reason || 'причина не указана'} · {formatDateTime(vehicle.offboarded_at || vehicle.updated_at)}
                </p>
              </div>
              <Badge tone={reviewTone(vehicle)}>
                {vehicle.review_required ? 'требует проверки' : 'без замечаний'}
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>Нет автомобилей в очереди проверки.</EmptyState>
      )}
    </Card>
  );
}

function EvidencePanel({ report }: { report: ResidentOffboardingReport }) {
  return (
    <Card
      title="Подтверждения"
      subtitle={`${report.evidence.report_scope} · ${formatDateTime(report.evidence.generated_at)}`}
    >
      <p className={uiClasses.resourceMeta}>
        Таблицы: {report.evidence.source_tables.join(', ')}
      </p>
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
