import { useMemo, useState } from 'react';
import { apiV1Url } from '../../config/apiBaseUrl';
import { api, isV1ApiError } from '../api';
import { useV1Session } from '../store';
import { getPropertyLabels } from '../lib/propertyLabels';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Inline,
  Stack,
  Textarea,
  uiClasses,
} from '../components/ui';
import type { UnitImportResponse } from '../api/units';

function templateUrl(propertyType: string): string {
  const qs = new URLSearchParams({ property_type: propertyType });
  return apiV1Url(`/units/import/template?${qs.toString()}`);
}

export function OnboardingAdminPage() {
  const session = useV1Session();
  const labels = useMemo(() => getPropertyLabels(session.property_type), [session.property_type]);
  const [csv, setCsv] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UnitImportResponse | null>(null);
  const propertyType = labels.propertyType;

  const runImport = async () => {
    if (!session.property_id) {
      setError('К пользователю не привязан property_id');
      return;
    }
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.units.importRows({
        property_id: session.property_id,
        property_type: propertyType,
        csv,
      });
      setResult(res);
      setCsv('');
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось выполнить импорт');
    } finally {
      setSubmitting(false);
    }
  };

  const title = propertyType === 'cottage_community'
    ? 'Импорт домов/участков'
    : `Импорт: ${labels.unitField}`;

  return (
    <div className={uiClasses.pageShell}>
      <header className={uiClasses.pageHeader}>
        <h1 className={uiClasses.pageTitle}>Онбординг объекта</h1>
        <p className={uiClasses.pageSubtitle}>
          {session.property_slug ? session.property_slug : propertyType}
        </p>
      </header>

      <Stack>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Card
          title={title}
          actions={
            <Button
              variant="secondary"
              onClick={() => {
                window.location.assign(templateUrl(propertyType));
              }}
            >
              Скачать CSV
            </Button>
          }
        >
          <Field id="v1-onboarding-csv" label="CSV">
            <Textarea
              id="v1-onboarding-csv"
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              rows={10}
              placeholder={
                propertyType === 'cottage_community'
                  ? 'sector_or_street,house_or_plot_number,unit_type,owner_full_name,phone,resident_type,vehicle_plates,checkpoint_name,checkpoint_type,checkpoint_notes'
                  : 'building,entrance,unit_number,floor,full_name,phone,resident_type,vehicle_plates'
              }
              disabled={submitting}
            />
          </Field>
          <Inline>
            <Button onClick={runImport} loading={submitting} disabled={!csv.trim()}>
              Импортировать
            </Button>
          </Inline>
        </Card>

        {result ? <ImportResult result={result} /> : null}
      </Stack>
    </div>
  );
}

function ImportResult({ result }: { result: UnitImportResponse }) {
  return (
    <Card
      title="Результат импорта"
      actions={
        <Badge tone={result.readiness.ready ? 'success' : 'warning'}>
          {result.readiness.ready ? 'готово' : 'нужно завершить'}
        </Badge>
      }
    >
      <Stack>
        <Inline>
          <Badge tone="success">units: {result.imported.units}</Badge>
          <Badge tone="success">residents: {result.imported.residents}</Badge>
          <Badge tone="success">vehicles: {result.imported.vehicles}</Badge>
          <Badge tone="neutral">skipped: {sumValues(result.skipped)}</Badge>
        </Inline>
        {result.planned_access_points.length > 0 ? (
          <Inline>
            {result.planned_access_points.map((point) => (
              <Badge key={`${point.name}-${point.point_type}`} tone="info">
                {point.name} · {point.point_type}
              </Badge>
            ))}
          </Inline>
        ) : null}
        {result.access_topology.points.length > 0 ? (
          <Inline>
            {result.access_topology.points.map((point) => (
              <Badge key={point.id} tone={point.created ? 'success' : 'neutral'}>
                КПП: {point.name} · {point.created ? 'создано' : 'уже было'}
              </Badge>
            ))}
          </Inline>
        ) : null}
        {result.warnings.length > 0 ? (
          <Alert tone="warning">{result.warnings.join('; ')}</Alert>
        ) : null}
      </Stack>
    </Card>
  );
}

function sumValues(values: Record<string, number>): number {
  return Object.values(values).reduce((sum, value) => sum + value, 0);
}
