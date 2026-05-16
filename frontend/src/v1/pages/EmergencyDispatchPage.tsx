import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, isV1ApiError } from '../api';
import type {
  EmergencyDispatchDrillRecord,
  EmergencyDispatchProfile,
  EmergencyDispatchReadiness,
  EmergencyEscalationTarget,
  EmergencyOnCallRosterRow,
  EmergencyProviderDeliveryChannel,
  EmergencyProviderDeliveryEvidence,
  EmergencyProviderDeliveryStatus,
  EmergencyProviderNotificationEvidence,
  EmergencySeverity,
  EmergencyType,
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

const WINDOW_OPTIONS = [
  { value: 24, label: '24 часа' },
  { value: 72, label: '72 часа' },
  { value: 168, label: '7 дней' },
  { value: 720, label: '30 дней' },
] as const;

const EMERGENCY_TYPES: Array<{ value: EmergencyType; label: string }> = [
  { value: 'fire_smoke', label: 'Пожар / дым' },
  { value: 'access_control', label: 'Доступ / шлагбаум' },
  { value: 'security', label: 'Безопасность' },
  { value: 'water', label: 'Вода / протечка' },
  { value: 'heating', label: 'Отопление' },
  { value: 'electricity', label: 'Электричество' },
  { value: 'territory', label: 'Территория' },
  { value: 'contractor', label: 'Подрядчик' },
  { value: 'other', label: 'Другое' },
];

const SEVERITIES: EmergencySeverity[] = ['P0', 'P1', 'P2'];
const PROVIDER_CHANNELS: EmergencyProviderDeliveryChannel[] = [
  'web_push',
  'sms',
  'telegram',
  'email',
  'phone',
  'webhook',
  'external_dispatch',
  'contractor_company',
  'internal_roster',
];
const PROVIDER_STATUSES: EmergencyProviderDeliveryStatus[] = [
  'sent',
  'delivered',
  'acknowledged',
  'failed',
  'timed_out',
  'not_required',
];
const TARGETS: Array<{ value: EmergencyEscalationTarget; label: string }> = [
  { value: 'security', label: 'Охрана' },
  { value: 'concierge', label: 'Консьерж' },
  { value: 'technician', label: 'Техник' },
  { value: 'contractor', label: 'Подрядчик' },
  { value: 'property_admin', label: 'Админ объекта' },
  { value: 'management_company_admin', label: 'УК' },
];

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}

function severityTone(severity: EmergencySeverity): BadgeTone {
  if (severity === 'P0') return 'error';
  if (severity === 'P1') return 'warning';
  return 'info';
}

function statusTone(status: string): BadgeTone {
  if (status === 'failed' || status === 'cancelled') return 'error';
  if (status === 'passed' || status === 'resolved' || status === 'sent') return 'success';
  if (status === 'escalated' || status === 'dispatched' || status === 'running') return 'warning';
  return 'neutral';
}

function emergencyTypeLabel(type: EmergencyType): string {
  return EMERGENCY_TYPES.find((item) => item.value === type)?.label ?? type;
}

function targetLabel(target: EmergencyEscalationTarget): string {
  return TARGETS.find((item) => item.value === target)?.label ?? target;
}

function parseLatencyMsInput(value: string): { value?: number; error?: string } {
  const trimmed = value.trim();
  if (!trimmed) return {};
  if (!/^\d+$/.test(trimmed)) {
    return { error: 'Latency должен быть целым числом 0 или больше.' };
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    return { error: 'Latency слишком большой.' };
  }
  return { value: parsed };
}

export function EmergencyDispatchPage() {
  const session = useV1Session();
  const labels = useMemo(() => getPropertyLabels(session.property_type), [session.property_type]);
  const propertyId = session.property_id ?? null;
  const [windowHours, setWindowHours] = useState<number>(72);

  const query = useQuery({
    queryKey: ['v1', 'emergency-dispatch-readiness', propertyId, windowHours],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.emergencyDispatch.readiness({
      property_id: propertyId ?? undefined,
      window_hours: windowHours,
      limit: 25,
    }, { signal }),
  });

  if (!propertyId) {
    return (
      <div className={uiClasses.pageShell}>
        <header className={uiClasses.pageHeader}>
          <h1 className={uiClasses.pageTitle}>Emergency dispatch</h1>
        </header>
        <Alert tone="warning">Администратор не привязан к объекту.</Alert>
      </div>
    );
  }

  const readiness = query.data ?? null;

  return (
    <div className={uiClasses.pageShell}>
      <header className={uiClasses.pageHeader}>
        <h1 className={uiClasses.pageTitle}>Emergency dispatch</h1>
        <p className={uiClasses.pageSubtitle}>
          {labels.propertyKind}: аварийная очередь, дежурные, уведомления и drill evidence.
        </p>
      </header>

      <Stack>
        <Card>
          <Inline>
            <Field id="emergency-window" label="Окно evidence">
              <Select
                id="emergency-window"
                value={windowHours}
                onChange={(event) => setWindowHours(Number(event.target.value))}
              >
                {WINDOW_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </Field>
            {readiness ? (
              <p className={uiClasses.textMuted}>
                Обновлено: {formatDateTime(readiness.generated_at)}
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
            Не удалось загрузить emergency readiness: {isV1ApiError(query.error) ? query.error.message : 'ошибка сети'}
          </Alert>
        ) : null}

        {readiness ? (
          <DashboardContent
            readiness={readiness}
            propertyId={propertyId}
            onRefresh={() => void query.refetch()}
          />
        ) : null}
      </Stack>
    </div>
  );
}

function DashboardContent({
  readiness,
  propertyId,
  onRefresh,
}: {
  readiness: EmergencyDispatchReadiness;
  propertyId: string;
  onRefresh: () => void;
}) {
  return (
    <Stack>
      <section className={uiClasses.formGrid} aria-label="Emergency dispatch KPIs">
        <KpiTile
          title="Активные"
          value={readiness.summary.active_emergencies}
          tone={readiness.summary.active_emergencies > 0 ? 'warning' : 'success'}
        />
        <KpiTile
          title="P0"
          value={readiness.summary.p0_active}
          tone={readiness.summary.p0_active > 0 ? 'error' : 'success'}
        />
        <KpiTile
          title="SLA overdue"
          value={readiness.summary.first_response_overdue + readiness.summary.resolution_overdue}
          tone={readiness.summary.first_response_overdue + readiness.summary.resolution_overdue > 0 ? 'error' : 'success'}
        />
        <KpiTile
          title="Notify failed"
          value={readiness.summary.notification_failed}
          tone={readiness.summary.notification_failed > 0 ? 'warning' : 'success'}
        />
      </section>

      <EmergencyQueue rows={readiness.queue} onRefresh={onRefresh} />
      <OnCallRoster rows={readiness.on_call_roster} />
      <ProviderEvidence rows={readiness.provider_notification_evidence} />
      <ProviderDeliveryRecorder
        propertyId={propertyId}
        queue={readiness.queue}
        onRecorded={onRefresh}
      />
      <ProviderDeliveryEvidence rows={readiness.live_provider_delivery_evidence ?? []} />
      <DrillRecorder propertyId={propertyId} onRecorded={onRefresh} />
      <DrillRecords rows={readiness.drill_records} />
      <EvidencePanel readiness={readiness} />
    </Stack>
  );
}

function KpiTile({
  title,
  value,
  tone,
}: {
  title: string;
  value: number;
  tone: BadgeTone;
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

function EmergencyQueue({
  rows,
  onRefresh,
}: {
  rows: EmergencyDispatchProfile[];
  onRefresh: () => void;
}) {
  const mutation = useMutation({
    mutationFn: ({ requestId, action }: { requestId: string; action: 'acknowledge' | 'dispatch' | 'resolve' }) =>
      api.serviceRequests.emergencyDispatch(requestId, {
        action,
        notificationStatus: action === 'resolve' ? 'not_required' : undefined,
      }),
    onSuccess: onRefresh,
  });

  if (!rows.length) {
    return (
      <Card title="Аварийная очередь">
        <EmptyState>Активных аварийных заявок нет.</EmptyState>
      </Card>
    );
  }

  return (
    <Card title="Аварийная очередь">
      <ul className={uiClasses.resourceList}>
        {rows.map((row) => (
          <li className={uiClasses.resourceRow} key={row.id}>
            <div className={uiClasses.resourceRowMain}>
              <Inline>
                <p className={uiClasses.resourceTitle}>{emergencyTypeLabel(row.emergencyType)}</p>
                <Badge tone={severityTone(row.severity)}>{row.severity}</Badge>
                <Badge tone={statusTone(row.dispatchStatus)}>{row.dispatchStatus}</Badge>
              </Inline>
              <p className={uiClasses.resourceMeta}>
                #{row.requestId.slice(0, 8)} · {row.request?.category ?? row.emergencyType} · {targetLabel(row.escalationTarget)}
              </p>
              {row.request?.comment ? <p className={uiClasses.textMuted}>{row.request.comment}</p> : null}
            </div>
            <dl className={uiClasses.staffMetaGrid}>
              <Metric label="Первый ответ" value={formatDateTime(row.firstResponseDueAt)} />
              <Metric label="Решение" value={formatDateTime(row.resolutionDueAt)} />
              <Metric label="Уведомления" value={row.notificationStatus} />
            </dl>
            <Inline>
              <Button
                variant="secondary"
                loading={mutation.isPending}
                onClick={() => mutation.mutate({ requestId: row.requestId, action: 'acknowledge' })}
              >
                Подтвердить
              </Button>
              <Button
                variant="secondary"
                loading={mutation.isPending}
                onClick={() => mutation.mutate({ requestId: row.requestId, action: 'dispatch' })}
              >
                Отправить
              </Button>
              <Button
                variant="primary"
                loading={mutation.isPending}
                onClick={() => mutation.mutate({ requestId: row.requestId, action: 'resolve' })}
              >
                Закрыть
              </Button>
            </Inline>
          </li>
        ))}
      </ul>
      {mutation.isError ? (
        <Alert tone="error">
          Действие не записано: {isV1ApiError(mutation.error) ? mutation.error.message : 'ошибка сети'}
        </Alert>
      ) : null}
    </Card>
  );
}

function OnCallRoster({ rows }: { rows: EmergencyOnCallRosterRow[] }) {
  if (!rows.length) {
    return (
      <Card title="On-call roster">
        <EmptyState>Активные дежурные не настроены.</EmptyState>
      </Card>
    );
  }

  return (
    <Card title="On-call roster">
      <ul className={uiClasses.resourceList}>
        {rows.map((row) => (
          <li className={uiClasses.resourceRow} key={row.id}>
            <div className={uiClasses.resourceRowMain}>
              <Inline>
                <p className={uiClasses.resourceTitle}>{row.displayName}</p>
                <Badge tone="info">{targetLabel(row.escalationTarget)}</Badge>
              </Inline>
              <p className={uiClasses.resourceMeta}>
                {row.provider} · {row.contactRef || 'contact ref hidden'} · priority {row.priority}
              </p>
            </div>
            <Badge tone="success">{row.status}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ProviderEvidence({ rows }: { rows: EmergencyProviderNotificationEvidence[] }) {
  if (!rows.length) {
    return (
      <Card title="Подтверждение уведомлений провайдера">
        <EmptyState>Нет записей отправки аварийных уведомлений в выбранном окне.</EmptyState>
      </Card>
    );
  }

  return (
    <Card title="Подтверждение уведомлений провайдера">
      <ul className={uiClasses.resourceList}>
        {rows.map((row) => (
          <li className={uiClasses.resourceRow} key={`${row.channel}-${row.status}`}>
            <div className={uiClasses.resourceRowMain}>
              <Inline>
                <p className={uiClasses.resourceTitle}>{row.channel}</p>
                <Badge tone={statusTone(row.status)}>{row.status}</Badge>
              </Inline>
              <p className={uiClasses.resourceMeta}>Последнее событие: {formatDateTime(row.lastEventAt)}</p>
            </div>
            <dl className={uiClasses.staffMetaGrid}>
              <Metric label="Всего" value={formatNumber(row.total)} />
              <Metric label="Ошибки" value={formatNumber(row.failed)} />
            </dl>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ProviderDeliveryRecorder({
  propertyId,
  queue,
  onRecorded,
}: {
  propertyId: string;
  queue: EmergencyDispatchProfile[];
  onRecorded: () => void;
}) {
  const [provider, setProvider] = useState('internal_roster');
  const [channel, setChannel] = useState<EmergencyProviderDeliveryChannel>('telegram');
  const [status, setStatus] = useState<EmergencyProviderDeliveryStatus>('delivered');
  const [latencyMs, setLatencyMs] = useState('');
  const [requestId, setRequestId] = useState(queue[0]?.requestId ?? '');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setRequestId((current) => {
      if (!current || queue.some((row) => row.requestId === current)) return current;
      return queue[0]?.requestId ?? '';
    });
  }, [queue]);

  const mutation = useMutation({
    mutationFn: (payload: { provider: string; latencyMs?: number }) => api.serviceRequests.recordProviderDeliveryEvidence({
      property_id: propertyId,
      requestId: requestId || undefined,
      provider: payload.provider,
      channel,
      status,
      scenarioType: 'other',
      latencyMs: payload.latencyMs,
      payload: { recorded_from: 'emergency_dispatch_ui' },
    }),
    onSuccess: () => {
      setLatencyMs('');
      setFormError(null);
      onRecorded();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const providerName = provider.trim();
    if (!providerName) {
      setFormError('Укажите провайдера.');
      return;
    }
    const parsedLatency = parseLatencyMsInput(latencyMs);
    if (parsedLatency.error) {
      setFormError(parsedLatency.error);
      return;
    }
    setFormError(null);
    mutation.mutate({ provider: providerName, latencyMs: parsedLatency.value });
  };

  return (
    <Card title="Записать provider delivery evidence">
      <form onSubmit={submit}>
        <Stack>
          <Inline>
            <Field id="provider-name" label="Провайдер">
              <Input
                id="provider-name"
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
                placeholder="internal_roster"
              />
            </Field>
            <Field id="provider-channel" label="Канал">
              <Select
                id="provider-channel"
                value={channel}
                onChange={(event) => setChannel(event.target.value as EmergencyProviderDeliveryChannel)}
              >
                {PROVIDER_CHANNELS.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </Select>
            </Field>
            <Field id="provider-status" label="Статус">
              <Select
                id="provider-status"
                value={status}
                onChange={(event) => setStatus(event.target.value as EmergencyProviderDeliveryStatus)}
              >
                {PROVIDER_STATUSES.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </Select>
            </Field>
          </Inline>
          <Inline>
            <Field id="provider-request" label="Заявка">
              <Select
                id="provider-request"
                value={requestId}
                onChange={(event) => setRequestId(event.target.value)}
              >
                <option value="">Без заявки</option>
                {queue.map((row) => (
                  <option key={row.requestId} value={row.requestId}>
                    #{row.requestId.slice(0, 8)} · {row.request?.comment || row.emergencyType}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="provider-latency" label="Latency, ms">
              <Input
                id="provider-latency"
                value={latencyMs}
                inputMode="numeric"
                onChange={(event) => setLatencyMs(event.target.value)}
                placeholder="1200"
              />
            </Field>
          </Inline>
          {mutation.isError ? (
            <Alert tone="error">
              Evidence не записан: {isV1ApiError(mutation.error) ? mutation.error.message : 'ошибка сети'}
            </Alert>
          ) : null}
          {formError ? <Alert tone="error">{formError}</Alert> : null}
          {mutation.isSuccess ? <Alert tone="success">Evidence записан.</Alert> : null}
          <Button type="submit" loading={mutation.isPending}>Записать evidence</Button>
        </Stack>
      </form>
    </Card>
  );
}

function ProviderDeliveryEvidence({ rows }: { rows: EmergencyProviderDeliveryEvidence[] }) {
  if (!rows.length) {
    return (
      <Card title="Live provider delivery evidence">
        <EmptyState>Provider delivery evidence в выбранном окне не найден.</EmptyState>
      </Card>
    );
  }

  return (
    <Card title="Live provider delivery evidence">
      <ul className={uiClasses.resourceList}>
        {rows.map((row) => (
          <li className={uiClasses.resourceRow} key={row.id}>
            <div className={uiClasses.resourceRowMain}>
              <Inline>
                <p className={uiClasses.resourceTitle}>{row.provider}</p>
                <Badge tone={statusTone(row.status)}>{row.status}</Badge>
              </Inline>
              <p className={uiClasses.resourceMeta}>
                {row.channel} · {formatDateTime(row.observedAt)} · {row.latencyMs ?? '—'} ms
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function DrillRecorder({
  propertyId,
  onRecorded,
}: {
  propertyId: string;
  onRecorded: () => void;
}) {
  const [scenarioType, setScenarioType] = useState<EmergencyType>('access_control');
  const [severity, setSeverity] = useState<EmergencySeverity>('P1');
  const [escalationTarget, setEscalationTarget] = useState<EmergencyEscalationTarget>('security');
  const [summary, setSummary] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.emergencyDispatch.createDrill({
      property_id: propertyId,
      scenarioType,
      severity,
      escalationTarget,
      status: 'passed',
      summary: summary.trim() || undefined,
      findings: { recorded_from: 'emergency_dispatch_ui' },
      notificationEvidence: { event_type: 'request.emergency_created' },
    }),
    onSuccess: () => {
      setSummary('');
      onRecorded();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  return (
    <Card title="Записать drill">
      <form onSubmit={submit}>
        <Stack>
          <Inline>
            <Field id="drill-type" label="Сценарий">
              <Select
                id="drill-type"
                value={scenarioType}
                onChange={(event) => setScenarioType(event.target.value as EmergencyType)}
              >
                {EMERGENCY_TYPES.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </Select>
            </Field>
            <Field id="drill-severity" label="Severity">
              <Select
                id="drill-severity"
                value={severity}
                onChange={(event) => setSeverity(event.target.value as EmergencySeverity)}
              >
                {SEVERITIES.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </Select>
            </Field>
            <Field id="drill-target" label="Маршрут">
              <Select
                id="drill-target"
                value={escalationTarget}
                onChange={(event) => setEscalationTarget(event.target.value as EmergencyEscalationTarget)}
              >
                {TARGETS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </Select>
            </Field>
          </Inline>
          <Field id="drill-summary" label="Итог">
            <Input
              id="drill-summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="Например: охрана подтвердила за 2 минуты"
            />
          </Field>
          {mutation.isError ? (
            <Alert tone="error">
              Drill не записан: {isV1ApiError(mutation.error) ? mutation.error.message : 'ошибка сети'}
            </Alert>
          ) : null}
          {mutation.isSuccess ? <Alert tone="success">Drill записан.</Alert> : null}
          <Button type="submit" loading={mutation.isPending}>Записать drill</Button>
        </Stack>
      </form>
    </Card>
  );
}

function DrillRecords({ rows }: { rows: EmergencyDispatchDrillRecord[] }) {
  if (!rows.length) {
    return (
      <Card title="Drill records">
        <EmptyState>Drill records пока не записаны.</EmptyState>
      </Card>
    );
  }

  return (
    <Card title="Drill records">
      <ul className={uiClasses.resourceList}>
        {rows.map((row) => (
          <li className={uiClasses.resourceRow} key={row.id}>
            <div className={uiClasses.resourceRowMain}>
              <Inline>
                <p className={uiClasses.resourceTitle}>{emergencyTypeLabel(row.scenarioType)}</p>
                <Badge tone={severityTone(row.severity)}>{row.severity}</Badge>
                <Badge tone={statusTone(row.status)}>{row.status}</Badge>
              </Inline>
              <p className={uiClasses.resourceMeta}>
                {targetLabel(row.escalationTarget)} · {formatDateTime(row.completedAt || row.startedAt || row.createdAt)}
              </p>
              {row.summary ? <p className={uiClasses.textMuted}>{row.summary}</p> : null}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function EvidencePanel({ readiness }: { readiness: EmergencyDispatchReadiness }) {
  return (
    <Card
      title="Подтверждение готовности"
      subtitle={`${formatNumber(readiness.evidence.returned_queue_rows)} строк очереди, ${formatNumber(readiness.evidence.returned_drill_rows)} строк учений`}
    >
      <dl className={uiClasses.staffMetaGrid}>
        <Metric label="Тип события" value={readiness.evidence.notification_event_type} />
        <Metric label="Строки состава" value={formatNumber(readiness.evidence.returned_roster_rows)} />
        <Metric label="Строки уведомлений" value={formatNumber(readiness.evidence.returned_notification_rows)} />
      </dl>
      <p className={uiClasses.resourceMeta}>
        Таблицы: {readiness.evidence.source_tables.join(', ')}
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
