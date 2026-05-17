import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, isV1ApiError } from '../api';
import type {
  ComplianceEvidenceStatus,
  ComplianceEvidenceType,
  DataSubjectRequestCompletionStatus,
  DataSubjectRequestStatus,
  DataSubjectRequestType,
} from '../api/privacyCompliance';
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
  Textarea,
  uiClasses,
} from '../components/ui';

const REQUEST_TYPES: DataSubjectRequestType[] = ['export', 'delete', 'correct', 'restrict'];
const REQUEST_STATUSES: Array<DataSubjectRequestStatus | ''> = ['', 'pending', 'in_progress', 'completed', 'rejected', 'cancelled'];
const COMPLETION_STATUSES: DataSubjectRequestCompletionStatus[] = ['in_progress', 'completed', 'rejected', 'cancelled'];
const EVIDENCE_TYPES: ComplianceEvidenceType[] = [
  'dsar_workflow',
  'retention_sweep',
  'data_localization',
  'ispdn_readiness',
  'no_biometrics_release_guard',
  'consent_history',
  'deletion_procedure',
];
const EVIDENCE_STATUSES: Array<ComplianceEvidenceStatus | ''> = ['', 'draft', 'ready', 'reviewed', 'blocked'];

function formatUnknown(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function recordString(record: Record<string, unknown>, keys: string[], fallback = '—'): string {
  for (const key of keys) {
    const value = record[key];
    if (value !== null && value !== undefined && value !== '') return String(value);
  }
  return fallback;
}

function parseJsonObject(value: string, fallback: Record<string, unknown>): Record<string, unknown> {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON должен быть объектом');
  }
  return parsed as Record<string, unknown>;
}

function requiredTrim(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`Укажите ${label}`);
  return trimmed;
}

export function PrivacyCompliancePage() {
  const session = useV1Session();
  const propertyId = session.property_id ?? null;
  const queryClient = useQueryClient();
  const [requestStatus, setRequestStatus] = useState<DataSubjectRequestStatus | ''>('');
  const [requestTypeFilter, setRequestTypeFilter] = useState<DataSubjectRequestType | ''>('');
  const [evidenceStatus, setEvidenceStatus] = useState<ComplianceEvidenceStatus | ''>('');
  const [evidenceTypeFilter, setEvidenceTypeFilter] = useState<ComplianceEvidenceType | ''>('');
  const [consentVersion, setConsentVersion] = useState('');
  const [requestType, setRequestType] = useState<DataSubjectRequestType>('export');
  const [subjectUid, setSubjectUid] = useState('');
  const [subjectResidentId, setSubjectResidentId] = useState('');
  const [requestReason, setRequestReason] = useState('');
  const [completeRequestId, setCompleteRequestId] = useState('');
  const [completionStatus, setCompletionStatus] = useState<DataSubjectRequestCompletionStatus>('completed');
  const [completionDecision, setCompletionDecision] = useState('');
  const [completionEvidenceJson, setCompletionEvidenceJson] = useState('');
  const [exportResidentId, setExportResidentId] = useState('');
  const [evidenceType, setEvidenceType] = useState<ComplianceEvidenceType>('dsar_workflow');
  const [evidenceCreateStatus, setEvidenceCreateStatus] = useState<ComplianceEvidenceStatus>('ready');
  const [evidenceSummary, setEvidenceSummary] = useState('');
  const [evidenceArtifactUri, setEvidenceArtifactUri] = useState('');
  const [evidenceJson, setEvidenceJson] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const readinessQuery = useQuery({
    queryKey: ['v1', 'privacy', 'readiness', propertyId],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.privacyCompliance.getReadiness({ property_id: propertyId ?? '' }, { signal }),
  });
  const consentQuery = useQuery({
    queryKey: ['v1', 'privacy', 'consent'],
    queryFn: ({ signal }) => api.privacyCompliance.getConsent({ signal }),
  });
  const requestsQuery = useQuery({
    queryKey: ['v1', 'privacy', 'data-subject-requests', propertyId, requestStatus, requestTypeFilter],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.privacyCompliance.listDataSubjectRequests({
      property_id: propertyId ?? '',
      status: requestStatus || undefined,
      request_type: requestTypeFilter || undefined,
      limit: 25,
    }, { signal }),
  });
  const evidenceQuery = useQuery({
    queryKey: ['v1', 'privacy', 'compliance-evidence', propertyId, evidenceStatus, evidenceTypeFilter],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.privacyCompliance.listComplianceEvidence({
      property_id: propertyId ?? '',
      status: evidenceStatus || undefined,
      evidence_type: evidenceTypeFilter || undefined,
      limit: 25,
    }, { signal }),
  });
  const exportQuery = useQuery({
    queryKey: ['v1', 'privacy', 'data-subject-export', propertyId, exportResidentId],
    enabled: false,
    queryFn: ({ signal }) => api.privacyCompliance.getDataSubjectExport({
      property_id: propertyId ?? undefined,
      subject_resident_id: requiredTrim(exportResidentId, 'resident ID для export'),
    }, { signal }),
  });

  const invalidatePrivacy = () => {
    void queryClient.invalidateQueries({ queryKey: ['v1', 'privacy'] });
  };

  const acceptConsentMutation = useMutation({
    mutationFn: () => api.privacyCompliance.acceptConsent({ version: requiredTrim(consentVersion, 'версию согласия') }),
    onSuccess: invalidatePrivacy,
    onError: (error) => setFormError(isV1ApiError(error) ? error.message : error instanceof Error ? error.message : 'Не удалось зафиксировать consent'),
  });
  const createRequestMutation = useMutation({
    mutationFn: () => {
      const uid = subjectUid.trim();
      const residentId = subjectResidentId.trim();
      if (!uid && !residentId) throw new Error('Укажите Subject UID или Resident ID');
      return api.privacyCompliance.createDataSubjectRequest({
        property_id: propertyId ?? undefined,
        request_type: requestType,
        subject_uid: uid || undefined,
        subject_resident_id: residentId || null,
        reason: requestReason.trim() || null,
        metadata: { source: 'privacy_compliance_ui' },
      });
    },
    onSuccess: invalidatePrivacy,
    onError: (error) => setFormError(isV1ApiError(error) ? error.message : error instanceof Error ? error.message : 'Не удалось создать DSAR'),
  });
  const completeRequestMutation = useMutation({
    mutationFn: () => {
      const evidence = parseJsonObject(completionEvidenceJson, { source: 'privacy_compliance_ui' });
      return api.privacyCompliance.completeDataSubjectRequest(requiredTrim(completeRequestId, 'request ID'), {
        status: completionStatus,
        decision: completionDecision.trim() || undefined,
        evidence,
      });
    },
    onSuccess: invalidatePrivacy,
    onError: (error) => setFormError(isV1ApiError(error) ? error.message : error instanceof Error ? error.message : 'Не удалось завершить DSAR'),
  });
  const createEvidenceMutation = useMutation({
    mutationFn: () => {
      const evidence = parseJsonObject(evidenceJson, { source: 'privacy_compliance_ui' });
      return api.privacyCompliance.createComplianceEvidence({
        property_id: propertyId ?? undefined,
        evidence_type: evidenceType,
        status: evidenceCreateStatus,
        summary: requiredTrim(evidenceSummary, 'summary evidence'),
        artifact_uri: evidenceArtifactUri.trim() || null,
        evidence,
      });
    },
    onSuccess: invalidatePrivacy,
    onError: (error) => setFormError(isV1ApiError(error) ? error.message : error instanceof Error ? error.message : 'Не удалось создать evidence'),
  });
  const deleteAccountMutation = useMutation({
    mutationFn: () => api.privacyCompliance.deleteAccount({ reason: requiredTrim(deleteReason, 'причину удаления') }),
    onSuccess: invalidatePrivacy,
    onError: (error) => setFormError(isV1ApiError(error) ? error.message : error instanceof Error ? error.message : 'Не удалось удалить аккаунт'),
  });

  if (!propertyId) {
    return (
      <div className={uiClasses.pageShell}>
        <header className={uiClasses.pageHeader}>
          <h1 className={uiClasses.pageTitle}>Privacy compliance</h1>
        </header>
        <Alert tone="warning">Администратор не привязан к объекту.</Alert>
      </div>
    );
  }

  const readiness = readinessQuery.data?.readiness ?? null;
  const consent = consentQuery.data ?? null;
  const requests = requestsQuery.data?.requests ?? [];
  const evidence = evidenceQuery.data?.evidence ?? [];
  const exportPayload = exportQuery.data?.export ?? null;
  const pageError = [
    readinessQuery,
    consentQuery,
    requestsQuery,
    evidenceQuery,
    exportQuery,
  ].find((query) => query.isError)?.error;

  function run(action: () => void) {
    setFormError(null);
    try {
      action();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Некорректные данные формы');
    }
  }

  return (
    <div className={uiClasses.pageShell}>
      <header className={uiClasses.pageHeader}>
        <h1 className={uiClasses.pageTitle}>Privacy compliance</h1>
        <p className={uiClasses.pageSubtitle}>
          DSAR, экспорт данных, evidence и readiness по privacy/legal контролям.
        </p>
      </header>

      <Stack>
        {pageError ? (
          <Alert tone="error">
            Не удалось загрузить privacy данные: {isV1ApiError(pageError) ? pageError.message : 'неизвестная ошибка'}
          </Alert>
        ) : null}
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <section className={uiClasses.formGrid} aria-label="Privacy summary">
          <Kpi title="Readiness" value={recordString(readiness ?? {}, ['status', 'overall_status', 'readiness'], readiness ? 'loaded' : '—')} />
          <Kpi title="Consent" value={consent?.needsAcceptance ? 'needs acceptance' : 'current'} tone={consent?.needsAcceptance ? 'warning' : 'success'} />
          <Kpi title="DSAR" value={requests.length} />
          <Kpi title="Evidence" value={evidence.length} />
        </section>

        <Card title="Consent">
          {consentQuery.isLoading ? <LoadingLine>Загрузка consent…</LoadingLine> : null}
          {consent ? (
            <dl className={uiClasses.staffMetaGrid}>
              <Metric label="Current" value={consent.currentVersion} />
              <Metric label="Accepted" value={consent.acceptedVersion ?? '—'} />
              <Metric label="Accepted at" value={consent.acceptedAt ? formatDateTime(consent.acceptedAt) : '—'} />
            </dl>
          ) : null}
          <div className={uiClasses.formGrid}>
            <Field label="Версия">
              <Input value={consentVersion} onChange={(e) => setConsentVersion(e.target.value)} placeholder="2026-05-17" />
            </Field>
            <Button
              variant="secondary"
              loading={acceptConsentMutation.isPending}
              onClick={() => {
                if (!consentVersion.trim()) {
                  setFormError('Укажите версию согласия');
                  return;
                }
                acceptConsentMutation.mutate();
              }}
            >
              Зафиксировать consent
            </Button>
          </div>
        </Card>

        <Card title="Data subject requests">
          <div className={uiClasses.formGrid}>
            <Field label="Статус">
              <Select value={requestStatus} onChange={(e) => setRequestStatus(e.target.value as DataSubjectRequestStatus | '')}>
                {REQUEST_STATUSES.map((item) => <option key={item || 'all'} value={item}>{item || 'Все'}</option>)}
              </Select>
            </Field>
            <Field label="Тип">
              <Select value={requestTypeFilter} onChange={(e) => setRequestTypeFilter(e.target.value as DataSubjectRequestType | '')}>
                <option value="">Все</option>
                {REQUEST_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Field>
          </div>
          {requestsQuery.isLoading ? <LoadingLine>Загрузка DSAR…</LoadingLine> : null}
          <ResourceRecords rows={requests} empty="DSAR-заявок нет." />
          <div className={uiClasses.formGrid}>
            <Field label="Новый тип">
              <Select value={requestType} onChange={(e) => setRequestType(e.target.value as DataSubjectRequestType)}>
                {REQUEST_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Field>
            <Field label="Subject UID">
              <Input value={subjectUid} onChange={(e) => setSubjectUid(e.target.value)} placeholder="user-uid" />
            </Field>
            <Field label="Resident ID">
              <Input value={subjectResidentId} onChange={(e) => setSubjectResidentId(e.target.value)} placeholder="resident-uuid" />
            </Field>
            <Field label="Причина">
              <Input value={requestReason} onChange={(e) => setRequestReason(e.target.value)} placeholder="Запрос субъекта данных" />
            </Field>
            <Button loading={createRequestMutation.isPending} onClick={() => createRequestMutation.mutate()}>
              Создать DSAR
            </Button>
          </div>
          <div className={uiClasses.formGrid}>
            <Field label="Request ID">
              <Input value={completeRequestId} onChange={(e) => setCompleteRequestId(e.target.value)} placeholder="request-id" />
            </Field>
            <Field label="Результат">
              <Select value={completionStatus} onChange={(e) => setCompletionStatus(e.target.value as DataSubjectRequestCompletionStatus)}>
                {COMPLETION_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Field>
            <Field label="Decision">
              <Input value={completionDecision} onChange={(e) => setCompletionDecision(e.target.value)} placeholder="completed by operator" />
            </Field>
            <Field label="Evidence JSON">
              <Textarea value={completionEvidenceJson} onChange={(e) => setCompletionEvidenceJson(e.target.value)} placeholder='{"ticket":"DSAR-1"}' rows={3} />
            </Field>
            <Button
              variant="secondary"
              loading={completeRequestMutation.isPending}
              onClick={() => {
                if (!completeRequestId.trim()) {
                  setFormError('Укажите request ID');
                  return;
                }
                run(() => completeRequestMutation.mutate());
              }}
            >
              Завершить DSAR
            </Button>
          </div>
        </Card>

        <Card title="Data subject export">
          <div className={uiClasses.formGrid}>
            <Field label="Resident ID">
              <Input value={exportResidentId} onChange={(e) => setExportResidentId(e.target.value)} placeholder="resident-uuid" />
            </Field>
            <Button variant="secondary" loading={exportQuery.isFetching} onClick={() => run(() => {
              requiredTrim(exportResidentId, 'resident ID для export');
              void exportQuery.refetch();
            })}>
              Получить export
            </Button>
          </div>
          {exportQuery.isError ? (
            <Alert tone="error">
              Не удалось получить export: {isV1ApiError(exportQuery.error) ? exportQuery.error.message : 'неизвестная ошибка'}
            </Alert>
          ) : null}
          {exportPayload ? (
            <pre className={uiClasses.codeBlock}>{JSON.stringify(exportPayload, null, 2)}</pre>
          ) : (
            <EmptyState>Экспорт еще не запрашивался.</EmptyState>
          )}
        </Card>

        <Card title="Compliance evidence">
          <div className={uiClasses.formGrid}>
            <Field label="Тип evidence">
              <Select value={evidenceTypeFilter} onChange={(e) => setEvidenceTypeFilter(e.target.value as ComplianceEvidenceType | '')}>
                <option value="">Все</option>
                {EVIDENCE_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Field>
            <Field label="Статус">
              <Select value={evidenceStatus} onChange={(e) => setEvidenceStatus(e.target.value as ComplianceEvidenceStatus | '')}>
                {EVIDENCE_STATUSES.map((item) => <option key={item || 'all'} value={item}>{item || 'Все'}</option>)}
              </Select>
            </Field>
          </div>
          {evidenceQuery.isLoading ? <LoadingLine>Загрузка evidence…</LoadingLine> : null}
          <ResourceRecords rows={evidence} empty="Evidence еще не зафиксированы." />
          <div className={uiClasses.formGrid}>
            <Field label="Новый тип evidence">
              <Select value={evidenceType} onChange={(e) => setEvidenceType(e.target.value as ComplianceEvidenceType)}>
                {EVIDENCE_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Field>
            <Field label="Статус">
              <Select value={evidenceCreateStatus} onChange={(e) => setEvidenceCreateStatus(e.target.value as ComplianceEvidenceStatus)}>
                {EVIDENCE_STATUSES.filter(Boolean).map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Field>
            <Field label="Summary">
              <Input value={evidenceSummary} onChange={(e) => setEvidenceSummary(e.target.value)} placeholder="Пакет готов к проверке" />
            </Field>
            <Field label="Artifact URI">
              <Input value={evidenceArtifactUri} onChange={(e) => setEvidenceArtifactUri(e.target.value)} placeholder="s3://bucket/evidence.json" />
            </Field>
            <Field label="Evidence JSON">
              <Textarea value={evidenceJson} onChange={(e) => setEvidenceJson(e.target.value)} placeholder='{"control":"privacy"}' rows={3} />
            </Field>
            <Button
              loading={createEvidenceMutation.isPending}
              onClick={() => run(() => createEvidenceMutation.mutate())}
            >
              Создать evidence
            </Button>
          </div>
        </Card>

        <Card title="Account deletion">
          <div className={uiClasses.formGrid}>
            <Field label="Причина">
              <Input value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} placeholder="Запрос пользователя" />
            </Field>
            <Field label="Подтверждение">
              <Input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder="DELETE" />
            </Field>
            <Button
              variant="danger"
              loading={deleteAccountMutation.isPending}
              disabled={deleteConfirm !== 'DELETE'}
              onClick={() => deleteAccountMutation.mutate()}
            >
              Удалить мой аккаунт
            </Button>
          </div>
        </Card>
      </Stack>
    </div>
  );
}

function Kpi({
  title,
  value,
  tone = 'neutral',
}: {
  title: string;
  value: string | number;
  tone?: 'success' | 'warning' | 'error' | 'neutral' | 'info';
}) {
  return (
    <Card>
      <Stack>
        <Inline><Badge tone={tone}>{title}</Badge></Inline>
        <strong className={uiClasses.cardTitle}>{value}</strong>
      </Stack>
    </Card>
  );
}

function ResourceRecords({ rows, empty }: { rows: Array<Record<string, unknown>>; empty: string }) {
  if (!rows.length) return <EmptyState>{empty}</EmptyState>;
  return (
    <ul className={uiClasses.resourceList}>
      {rows.map((row, index) => (
        <li className={uiClasses.resourceRow} key={recordString(row, ['id'], String(index))}>
          <div className={uiClasses.resourceRowMain}>
            <p className={uiClasses.resourceTitle}>
              {recordString(row, ['request_type', 'evidence_type', 'type', 'id'], `record-${index + 1}`)}
            </p>
            <p className={uiClasses.resourceMeta}>
              {recordString(row, ['status'], 'unknown')} · {recordString(row, ['created_at', 'updated_at', 'completed_at'])}
            </p>
            <p className={uiClasses.textMuted}>
              {recordString(row, ['reason', 'summary', 'decision', 'artifact_uri'], formatUnknown(row))}
            </p>
          </div>
        </li>
      ))}
    </ul>
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

function LoadingLine({ children }: { children: string }) {
  return (
    <Inline>
      <Spinner />
      <span className={uiClasses.textMuted}>{children}</span>
    </Inline>
  );
}
