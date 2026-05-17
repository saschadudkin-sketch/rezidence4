import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, isV1ApiError } from '../api';
import type {
  ErpExportDataset,
  ErpImportDataset,
  ErpProviderInput,
  ErpProviderStatus,
  ErpSyncMode,
  ErpSyncSource,
} from '../api/erpExchange';
import type {
  SkudFailSafeMode,
  SkudFieldRolloutEvidenceType,
  SkudFieldRolloutStage,
  SkudFieldRolloutStatus,
  SkudMaintenanceStatus,
  SkudManualControlAction,
  SkudManualControlDecisionSource,
  SkudManualControlPolicy,
  SkudSyncPassAction,
} from '../api/skudIntegrations';
import type {
  VideoEvidenceSensitivity,
  VideoEvidenceStatus,
  VideoEvidenceType,
  VideoProviderKind,
  VideoProviderStatus,
} from '../api/videoEvidence';
import { useV1Session } from '../store';
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

const ERP_PROVIDERS: ErpProviderInput[] = ['one_c', 'one_c_zhkh', 'housing_erp', 'generic_csv', 'generic_rest', 'generic_webhook'];
const ERP_STATUSES: Array<ErpProviderStatus | ''> = ['', 'active', 'disabled', 'degraded'];
const ERP_SYNC_MODES: ErpSyncMode[] = ['hybrid', 'import_only', 'export_only', 'manual'];
const ERP_IMPORT_DATASETS: ErpImportDataset[] = ['property_structure', 'resident_registry', 'staff_registry', 'contractor_registry', 'vehicle_registry'];
const ERP_EXPORT_DATASETS: ErpExportDataset[] = ['access_events_summary', 'incident_summary', 'request_summary'];
const ERP_SOURCES: ErpSyncSource[] = ['manual', 'csv', 'rest', 'webhook'];

const SKUD_POLICIES: SkudManualControlPolicy[] = ['guard_allowed', 'admin_only', 'provider_only', 'prohibited'];
const SKUD_FAIL_SAFE: SkudFailSafeMode[] = ['fail_closed', 'fail_open_guarded', 'provider_default', 'manual_guard'];
const SKUD_MAINTENANCE: SkudMaintenanceStatus[] = ['normal', 'maintenance', 'out_of_service'];
const SKUD_ACTIONS: SkudManualControlAction[] = ['manual_open', 'manual_close', 'manual_block', 'manual_unblock', 'manual_reset', 'mark_degraded', 'mark_restored'];
const SKUD_DECISION_SOURCES: SkudManualControlDecisionSource[] = ['admin', 'guard', 'incident', 'provider_fallback'];
const SKUD_SYNC_ACTIONS: SkudSyncPassAction[] = ['provision', 'revoke'];
const SKUD_ROLLOUT_STAGES: SkudFieldRolloutStage[] = ['lab', 'staging', 'pilot', 'production'];
const SKUD_EVIDENCE_TYPES: SkudFieldRolloutEvidenceType[] = ['provider_delivery', 'field_drill', 'rollout_report', 'vendor_health_probe'];
const SKUD_EVIDENCE_STATUSES: SkudFieldRolloutStatus[] = ['planned', 'running', 'passed', 'failed', 'blocked'];

const VIDEO_PROVIDERS: VideoProviderKind[] = ['generic_link', 'trassir', 'macroscop', 'hikvision_nvr', 'dahua_nvr', 'axxon_next', 'devline_line'];
const VIDEO_STATUSES: Array<VideoProviderStatus | ''> = ['', 'active', 'disabled', 'degraded'];
const VIDEO_EVIDENCE_TYPES: VideoEvidenceType[] = ['clip', 'snapshot', 'event_reference', 'camera_context', 'unavailable'];
const VIDEO_EVIDENCE_STATUSES: VideoEvidenceStatus[] = ['linked', 'unavailable', 'expired', 'removed'];
const VIDEO_SENSITIVITY: VideoEvidenceSensitivity[] = ['restricted', 'sensitive'];

function parseJsonArray(value: string, fallback: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new Error('JSON должен быть массивом объектов');
  }
  return parsed as Array<Record<string, unknown>>;
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

function splitList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function recordLabel(record: Record<string, unknown>, keys: string[], fallback = 'record'): string {
  for (const key of keys) {
    const value = record[key];
    if (value !== null && value !== undefined && value !== '') return String(value);
  }
  return fallback;
}

function summarizeRecord(record: Record<string, unknown>): string {
  const parts = ['status', 'health_status', 'provider', 'event_type', 'action', 'created_at']
    .map((key) => record[key])
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map(String);
  return parts.length ? parts.join(' · ') : JSON.stringify(record);
}

function requiredTrim(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`Укажите ${label}`);
  return trimmed;
}

function requiredList(value: string, label: string): string[] {
  const list = splitList(value);
  if (!list.length) throw new Error(`Укажите ${label}`);
  return list;
}

type ReportApiError = (error: unknown, fallback: string) => void;

export function IntegrationOperationsPage() {
  const session = useV1Session();
  const propertyId = session.property_id ?? null;

  if (!propertyId) {
    return (
      <div className={uiClasses.pageShell}>
        <header className={uiClasses.pageHeader}>
          <h1 className={uiClasses.pageTitle}>Интеграции</h1>
        </header>
        <Alert tone="warning">Администратор не привязан к объекту.</Alert>
      </div>
    );
  }

  return <IntegrationOperationsContent propertyId={propertyId} />;
}

function IntegrationOperationsContent({ propertyId }: { propertyId: string }) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  function run(action: () => void) {
    setFormError(null);
    try {
      action();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Некорректные данные формы');
    }
  }
  const reportError: ReportApiError = (error, fallback) => {
    setFormError(isV1ApiError(error) ? error.message : error instanceof Error ? error.message : fallback);
  };

  const invalidateIntegrations = () => {
    void queryClient.invalidateQueries({ queryKey: ['v1', 'integrations'] });
  };

  return (
    <div className={uiClasses.pageShell}>
      <header className={uiClasses.pageHeader}>
        <h1 className={uiClasses.pageTitle}>Интеграции</h1>
        <p className={uiClasses.pageSubtitle}>
          ERP, СКУД, webhooks и video evidence для production operations.
        </p>
      </header>

      <Stack>
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <ErpSection propertyId={propertyId} invalidate={invalidateIntegrations} reportError={reportError} run={run} />
        <SkudSection propertyId={propertyId} invalidate={invalidateIntegrations} reportError={reportError} run={run} />
        <WebhooksSection invalidate={invalidateIntegrations} reportError={reportError} run={run} />
        <VideoSection propertyId={propertyId} invalidate={invalidateIntegrations} reportError={reportError} run={run} />
      </Stack>
    </div>
  );
}

function ErpSection({
  propertyId,
  invalidate,
  reportError,
  run,
}: {
  propertyId: string;
  invalidate: () => void;
  reportError: ReportApiError;
  run: (action: () => void) => void;
}) {
  const [status, setStatus] = useState<ErpProviderStatus | ''>('');
  const [provider, setProvider] = useState<ErpProviderInput>('one_c_zhkh');
  const [displayName, setDisplayName] = useState('');
  const [syncMode, setSyncMode] = useState<ErpSyncMode>('hybrid');
  const [baseUrl, setBaseUrl] = useState('');
  const [authRef, setAuthRef] = useState('');
  const [capabilities, setCapabilities] = useState('import,export');
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [importDataset, setImportDataset] = useState<ErpImportDataset>('resident_registry');
  const [exportDataset, setExportDataset] = useState<ErpExportDataset>('request_summary');
  const [syncSource, setSyncSource] = useState<ErpSyncSource>('manual');
  const [importRowsJson, setImportRowsJson] = useState('[{"external_id":"r-1","full_name":"Ivan Petrov"}]');
  const [exportLimit, setExportLimit] = useState('100');
  const [syncJobId, setSyncJobId] = useState('');

  const providersQuery = useQuery({
    queryKey: ['v1', 'integrations', 'erp', 'providers', propertyId, status],
    queryFn: ({ signal }) => api.erpExchange.listProviders({
      property_id: propertyId,
      status: status || undefined,
    }, { signal }),
  });
  const syncJobQuery = useQuery({
    queryKey: ['v1', 'integrations', 'erp', 'sync-job', propertyId, syncJobId],
    enabled: false,
    queryFn: ({ signal }) => api.erpExchange.getSyncJob(requiredTrim(syncJobId, 'sync job ID'), { property_id: propertyId }, { signal }),
  });

  const createProvider = useMutation({
    mutationFn: () => api.erpExchange.createProvider({
      property_id: propertyId,
      provider,
      display_name: requiredTrim(displayName, 'название ERP provider'),
      status: 'active',
      sync_mode: syncMode,
      base_url: baseUrl.trim() || null,
      auth_ref: authRef.trim() || null,
      capabilities: requiredList(capabilities, 'capabilities'),
    }),
    onSuccess: invalidate,
    onError: (error) => reportError(error, 'Не удалось создать ERP provider'),
  });
  const previewImport = useMutation({
    mutationFn: () => api.erpExchange.previewImport(requiredTrim(selectedProviderId, 'provider ID'), {
      property_id: propertyId,
      dataset: importDataset,
      source: syncSource,
      rows: parseJsonArray(importRowsJson, []),
    }),
    onSuccess: invalidate,
    onError: (error) => reportError(error, 'Не удалось preview ERP import'),
  });
  const applyImport = useMutation({
    mutationFn: () => api.erpExchange.applyImport(requiredTrim(selectedProviderId, 'provider ID'), {
      property_id: propertyId,
      dataset: importDataset,
      source: syncSource,
      rows: parseJsonArray(importRowsJson, []),
    }),
    onSuccess: invalidate,
    onError: (error) => reportError(error, 'Не удалось apply ERP import'),
  });
  const exportMutation = useMutation({
    mutationFn: () => api.erpExchange.exportDataset(requiredTrim(selectedProviderId, 'provider ID'), {
      property_id: propertyId,
      dataset: exportDataset,
      source: syncSource,
      limit: Number(exportLimit) || 100,
    }),
    onSuccess: invalidate,
    onError: (error) => reportError(error, 'Не удалось export ERP dataset'),
  });

  const providers = providersQuery.data?.providers ?? [];

  return (
    <Card title="ERP / 1C exchange" subtitle="Провайдеры, import preview/apply, export и sync-job detail.">
      <Stack>
        <div className={uiClasses.formGrid}>
          <Field label="Фильтр статуса">
            <Select value={status} onChange={(e) => setStatus(e.target.value as ErpProviderStatus | '')}>
              {ERP_STATUSES.map((item) => <option key={item || 'all'} value={item}>{item || 'Все'}</option>)}
            </Select>
          </Field>
          <Button variant="ghost" loading={providersQuery.isFetching} onClick={() => void providersQuery.refetch()}>
            Обновить ERP
          </Button>
        </div>
        {providersQuery.isError ? <QueryAlert error={providersQuery.error} /> : null}
        {providersQuery.isLoading ? <LoadingLine>Загрузка ERP…</LoadingLine> : null}
        <RecordList rows={providers as unknown as Array<Record<string, unknown>>} empty="ERP providers не настроены." />

        <section aria-label="ERP provider form">
          <h3 className={uiClasses.cardTitle}>Новый ERP provider</h3>
          <div className={uiClasses.formGrid}>
            <Field label="Provider">
              <Select value={provider} onChange={(e) => setProvider(e.target.value as ErpProviderInput)}>
                {ERP_PROVIDERS.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Field>
            <Field label="Название">
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="1C ZHKH" />
            </Field>
            <Field label="Sync mode">
              <Select value={syncMode} onChange={(e) => setSyncMode(e.target.value as ErpSyncMode)}>
                {ERP_SYNC_MODES.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Field>
            <Field label="Base URL">
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://erp.example" />
            </Field>
            <Field label="Auth ref">
              <Input value={authRef} onChange={(e) => setAuthRef(e.target.value)} placeholder="vault://erp/main" />
            </Field>
            <Field label="Capabilities">
              <Input value={capabilities} onChange={(e) => setCapabilities(e.target.value)} placeholder="import,export" />
            </Field>
            <Button loading={createProvider.isPending} onClick={() => createProvider.mutate()}>
              Создать ERP provider
            </Button>
          </div>
        </section>

        <section aria-label="ERP sync actions">
          <h3 className={uiClasses.cardTitle}>ERP sync actions</h3>
          <div className={uiClasses.formGrid}>
            <Field label="Provider ID">
              <Input value={selectedProviderId} onChange={(e) => setSelectedProviderId(e.target.value)} placeholder="provider-uuid" />
            </Field>
            <Field label="Import dataset">
              <Select value={importDataset} onChange={(e) => setImportDataset(e.target.value as ErpImportDataset)}>
                {ERP_IMPORT_DATASETS.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Field>
            <Field label="Export dataset">
              <Select value={exportDataset} onChange={(e) => setExportDataset(e.target.value as ErpExportDataset)}>
                {ERP_EXPORT_DATASETS.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Field>
            <Field label="Source">
              <Select value={syncSource} onChange={(e) => setSyncSource(e.target.value as ErpSyncSource)}>
                {ERP_SOURCES.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Field>
            <Field label="Rows JSON">
              <Textarea value={importRowsJson} onChange={(e) => setImportRowsJson(e.target.value)} rows={3} />
            </Field>
            <Field label="Export limit">
              <Input value={exportLimit} onChange={(e) => setExportLimit(e.target.value)} inputMode="numeric" />
            </Field>
          </div>
          <Inline>
            <Button variant="secondary" loading={previewImport.isPending} onClick={() => run(() => previewImport.mutate())}>Preview import</Button>
            <Button variant="secondary" loading={applyImport.isPending} onClick={() => run(() => applyImport.mutate())}>Apply import</Button>
            <Button variant="secondary" loading={exportMutation.isPending} onClick={() => exportMutation.mutate()}>Export dataset</Button>
          </Inline>
          <div className={uiClasses.formGrid}>
            <Field label="Sync job ID">
              <Input value={syncJobId} onChange={(e) => setSyncJobId(e.target.value)} placeholder="job-uuid" />
            </Field>
            <Button variant="ghost" loading={syncJobQuery.isFetching} onClick={() => run(() => {
              requiredTrim(syncJobId, 'sync job ID');
              void syncJobQuery.refetch();
            })}>
              Загрузить sync job
            </Button>
          </div>
          {syncJobQuery.isError ? <QueryAlert error={syncJobQuery.error} /> : null}
          {syncJobQuery.data ? <RecordList rows={[syncJobQuery.data.sync_job as unknown as Record<string, unknown>]} empty="" /> : null}
        </section>
      </Stack>
    </Card>
  );
}

function SkudSection({
  propertyId,
  invalidate,
  reportError,
  run,
}: {
  propertyId: string;
  invalidate: () => void;
  reportError: ReportApiError;
  run: (action: () => void) => void;
}) {
  const [deviceId, setDeviceId] = useState('');
  const [providerConfigId, setProviderConfigId] = useState('');
  const [accessPointId, setAccessPointId] = useState('');
  const [manualPolicy, setManualPolicy] = useState<SkudManualControlPolicy>('guard_allowed');
  const [failSafe, setFailSafe] = useState<SkudFailSafeMode>('manual_guard');
  const [maintenance, setMaintenance] = useState<SkudMaintenanceStatus>('normal');
  const [manualAction, setManualAction] = useState<SkudManualControlAction>('manual_open');
  const [decisionSource, setDecisionSource] = useState<SkudManualControlDecisionSource>('admin');
  const [manualReason, setManualReason] = useState('');
  const [passId, setPassId] = useState('');
  const [syncAction, setSyncAction] = useState<SkudSyncPassAction>('provision');
  const [rolloutStage, setRolloutStage] = useState<SkudFieldRolloutStage>('pilot');
  const [evidenceType, setEvidenceType] = useState<SkudFieldRolloutEvidenceType>('field_drill');
  const [evidenceStatus, setEvidenceStatus] = useState<SkudFieldRolloutStatus>('passed');
  const [evidenceSummary, setEvidenceSummary] = useState('');
  const [metricsJson, setMetricsJson] = useState('{"latency_ms":120}');

  const devicesQuery = useQuery({
    queryKey: ['v1', 'integrations', 'skud', 'devices', propertyId, providerConfigId, accessPointId],
    queryFn: ({ signal }) => api.skudIntegrations.listHardwareDevices({
      property_id: propertyId,
      provider_config_id: providerConfigId.trim() || undefined,
      access_point_id: accessPointId.trim() || undefined,
    }, { signal }),
  });
  const eventsQuery = useQuery({
    queryKey: ['v1', 'integrations', 'skud', 'manual-events', propertyId, deviceId],
    enabled: false,
    queryFn: ({ signal }) => api.skudIntegrations.listManualControlEvents(
      requiredTrim(deviceId, 'hardware device ID'),
      { property_id: propertyId, limit: 20 },
      { signal },
    ),
  });
  const updateBoundary = useMutation({
    mutationFn: () => api.skudIntegrations.updateHardwareBoundary(requiredTrim(deviceId, 'hardware device ID'), {
      property_id: propertyId,
      manual_control_policy: manualPolicy,
      fail_safe_mode: failSafe,
      maintenance_status: maintenance,
      manual_action_requires_reason: true,
    }),
    onSuccess: invalidate,
    onError: (error) => reportError(error, 'Не удалось сохранить SKUD boundary'),
  });
  const manualControl = useMutation({
    mutationFn: () => api.skudIntegrations.manualControl(requiredTrim(deviceId, 'hardware device ID'), {
      property_id: propertyId,
      action: manualAction,
      reason: requiredTrim(manualReason, 'reason для manual control'),
      decision_source: decisionSource,
      metadata: { source: 'integration_operations_ui' },
    }),
    onSuccess: invalidate,
    onError: (error) => reportError(error, 'Не удалось выполнить manual control'),
  });
  const rolloutEvidence = useMutation({
    mutationFn: () => api.skudIntegrations.recordFieldRolloutEvidence({
      property_id: propertyId,
      provider_config_id: providerConfigId.trim() || null,
      hardware_device_id: deviceId.trim() || null,
      rollout_stage: rolloutStage,
      evidence_type: evidenceType,
      status: evidenceStatus,
      summary: requiredTrim(evidenceSummary, 'summary evidence'),
      metrics: parseJsonObject(metricsJson, { source: 'integration_operations_ui' }),
    }),
    onSuccess: invalidate,
    onError: (error) => reportError(error, 'Не удалось записать SKUD rollout evidence'),
  });
  const syncPass = useMutation({
    mutationFn: () => api.skudIntegrations.syncPass(requiredTrim(providerConfigId, 'provider config ID'), {
      property_id: propertyId,
      pass_id: requiredTrim(passId, 'pass ID'),
      action: syncAction,
    }),
    onSuccess: invalidate,
    onError: (error) => reportError(error, 'Не удалось sync pass'),
  });

  const devices = devicesQuery.data?.hardware_devices ?? [];
  const events = eventsQuery.data?.manual_control_events ?? [];

  return (
    <Card title="СКУД hardware" subtitle="Boundary, manual control, rollout evidence и pass sync.">
      <Stack>
        {devicesQuery.isError ? <QueryAlert error={devicesQuery.error} /> : null}
        <div className={uiClasses.formGrid}>
          <Field label="Provider config ID">
            <Input value={providerConfigId} onChange={(e) => setProviderConfigId(e.target.value)} placeholder="skud-provider-uuid" />
          </Field>
          <Field label="Access point ID">
            <Input value={accessPointId} onChange={(e) => setAccessPointId(e.target.value)} placeholder="point-uuid" />
          </Field>
          <Button variant="ghost" loading={devicesQuery.isFetching} onClick={() => void devicesQuery.refetch()}>
            Обновить устройства
          </Button>
        </div>
        {devicesQuery.isLoading ? <LoadingLine>Загрузка устройств СКУД…</LoadingLine> : null}
        <RecordList rows={devices} empty="СКУД устройства не найдены." />

        <section aria-label="SKUD manual controls">
          <h3 className={uiClasses.cardTitle}>Boundary и manual control</h3>
          <div className={uiClasses.formGrid}>
            <Field label="Hardware device ID">
              <Input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} placeholder="device-uuid" />
            </Field>
            <Field label="Policy">
              <Select value={manualPolicy} onChange={(e) => setManualPolicy(e.target.value as SkudManualControlPolicy)}>
                {SKUD_POLICIES.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Field>
            <Field label="Fail-safe">
              <Select value={failSafe} onChange={(e) => setFailSafe(e.target.value as SkudFailSafeMode)}>
                {SKUD_FAIL_SAFE.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Field>
            <Field label="Maintenance">
              <Select value={maintenance} onChange={(e) => setMaintenance(e.target.value as SkudMaintenanceStatus)}>
                {SKUD_MAINTENANCE.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Field>
            <Field label="Action">
              <Select value={manualAction} onChange={(e) => setManualAction(e.target.value as SkudManualControlAction)}>
                {SKUD_ACTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Field>
            <Field label="Source">
              <Select value={decisionSource} onChange={(e) => setDecisionSource(e.target.value as SkudManualControlDecisionSource)}>
                {SKUD_DECISION_SOURCES.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Field>
            <Field label="Reason">
              <Input value={manualReason} onChange={(e) => setManualReason(e.target.value)} placeholder="Проверка КПП" />
            </Field>
          </div>
          <Inline>
            <Button variant="secondary" loading={updateBoundary.isPending} onClick={() => updateBoundary.mutate()}>Сохранить boundary</Button>
            <Button variant="secondary" loading={manualControl.isPending} onClick={() => manualControl.mutate()}>Manual control</Button>
            <Button variant="ghost" loading={eventsQuery.isFetching} onClick={() => run(() => {
              requiredTrim(deviceId, 'hardware device ID');
              void eventsQuery.refetch();
            })}>История manual</Button>
          </Inline>
          {eventsQuery.isError ? <QueryAlert error={eventsQuery.error} /> : null}
          <RecordList rows={events} empty="Manual-control событий нет." />
        </section>

        <section aria-label="SKUD rollout and pass sync">
          <h3 className={uiClasses.cardTitle}>Rollout evidence и pass sync</h3>
          <div className={uiClasses.formGrid}>
            <Field label="Rollout stage">
              <Select value={rolloutStage} onChange={(e) => setRolloutStage(e.target.value as SkudFieldRolloutStage)}>
                {SKUD_ROLLOUT_STAGES.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Field>
            <Field label="Evidence type">
              <Select value={evidenceType} onChange={(e) => setEvidenceType(e.target.value as SkudFieldRolloutEvidenceType)}>
                {SKUD_EVIDENCE_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Field>
            <Field label="Evidence status">
              <Select value={evidenceStatus} onChange={(e) => setEvidenceStatus(e.target.value as SkudFieldRolloutStatus)}>
                {SKUD_EVIDENCE_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Field>
            <Field label="Summary">
              <Input value={evidenceSummary} onChange={(e) => setEvidenceSummary(e.target.value)} placeholder="Полевой тест пройден" />
            </Field>
            <Field label="Metrics JSON">
              <Textarea value={metricsJson} onChange={(e) => setMetricsJson(e.target.value)} rows={3} />
            </Field>
            <Field label="Pass ID">
              <Input value={passId} onChange={(e) => setPassId(e.target.value)} placeholder="pass-uuid" />
            </Field>
            <Field label="Sync action">
              <Select value={syncAction} onChange={(e) => setSyncAction(e.target.value as SkudSyncPassAction)}>
                {SKUD_SYNC_ACTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Field>
          </div>
          <Inline>
            <Button variant="secondary" loading={rolloutEvidence.isPending} onClick={() => run(() => rolloutEvidence.mutate())}>Записать evidence</Button>
            <Button variant="secondary" loading={syncPass.isPending} onClick={() => syncPass.mutate()}>Sync pass</Button>
          </Inline>
        </section>
      </Stack>
    </Card>
  );
}

function WebhooksSection({
  invalidate,
  reportError,
  run,
}: {
  invalidate: () => void;
  reportError: ReportApiError;
  run: (action: () => void) => void;
}) {
  const [webhookId, setWebhookId] = useState('');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [events, setEvents] = useState('request.created,access.incident.created');
  const [active, setActive] = useState('true');

  const webhooksQuery = useQuery({
    queryKey: ['v1', 'integrations', 'webhooks'],
    queryFn: ({ signal }) => api.webhooks.list({ signal }),
  });
  const deliveriesQuery = useQuery({
    queryKey: ['v1', 'integrations', 'webhooks', webhookId, 'deliveries'],
    enabled: false,
    queryFn: ({ signal }) => api.webhooks.listDeliveries(requiredTrim(webhookId, 'webhook ID'), { signal }),
  });
  const createWebhook = useMutation({
    mutationFn: () => api.webhooks.create({
      name: requiredTrim(name, 'webhook name'),
      url: requiredTrim(url, 'webhook URL'),
      secret: requiredTrim(secret, 'webhook secret'),
      events: requiredList(events, 'webhook events'),
    }),
    onSuccess: invalidate,
    onError: (error) => reportError(error, 'Не удалось создать webhook'),
  });
  const updateWebhook = useMutation({
    mutationFn: () => api.webhooks.update(requiredTrim(webhookId, 'webhook ID'), {
      name: name.trim() || undefined,
      url: url.trim() || undefined,
      secret: secret.trim() || undefined,
      events: requiredList(events, 'webhook events'),
      is_active: active === 'true',
    }),
    onSuccess: invalidate,
    onError: (error) => reportError(error, 'Не удалось обновить webhook'),
  });
  const deactivateWebhook = useMutation({
    mutationFn: () => api.webhooks.deactivate(requiredTrim(webhookId, 'webhook ID')),
    onSuccess: invalidate,
    onError: (error) => reportError(error, 'Не удалось отключить webhook'),
  });
  const testDelivery = useMutation({
    mutationFn: () => api.webhooks.testDelivery(requiredTrim(webhookId, 'webhook ID')),
    onSuccess: invalidate,
    onError: (error) => reportError(error, 'Не удалось выполнить test delivery'),
  });

  const webhooks = webhooksQuery.data?.webhooks ?? [];
  const deliveries = deliveriesQuery.data?.deliveries ?? [];

  return (
    <Card title="Webhooks" subtitle="CRUD, test delivery и delivery history.">
      <Stack>
        {webhooksQuery.isError ? <QueryAlert error={webhooksQuery.error} /> : null}
        {webhooksQuery.isLoading ? <LoadingLine>Загрузка webhooks…</LoadingLine> : null}
        <RecordList rows={webhooks as unknown as Array<Record<string, unknown>>} empty="Webhooks не настроены." />
        <div className={uiClasses.formGrid}>
          <Field label="Webhook ID">
            <Input value={webhookId} onChange={(e) => setWebhookId(e.target.value)} placeholder="webhook-uuid" />
          </Field>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ERP bridge" />
          </Field>
          <Field label="URL">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://erp.example/webhook" />
          </Field>
          <Field label="Secret">
            <Input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="secret-ref" />
          </Field>
          <Field label="Events">
            <Input value={events} onChange={(e) => setEvents(e.target.value)} placeholder="request.created,access.incident.created" />
          </Field>
          <Field label="Active">
            <Select value={active} onChange={(e) => setActive(e.target.value)}>
              <option value="true">true</option>
              <option value="false">false</option>
            </Select>
          </Field>
        </div>
        <Inline>
          <Button loading={createWebhook.isPending} onClick={() => createWebhook.mutate()}>Создать webhook</Button>
          <Button variant="secondary" loading={updateWebhook.isPending} onClick={() => updateWebhook.mutate()}>Обновить webhook</Button>
          <Button variant="danger" loading={deactivateWebhook.isPending} onClick={() => deactivateWebhook.mutate()}>Отключить webhook</Button>
          <Button variant="secondary" loading={testDelivery.isPending} onClick={() => testDelivery.mutate()}>Test delivery</Button>
          <Button variant="ghost" loading={deliveriesQuery.isFetching} onClick={() => run(() => {
            requiredTrim(webhookId, 'webhook ID');
            void deliveriesQuery.refetch();
          })}>История delivery</Button>
        </Inline>
        {deliveriesQuery.isError ? <QueryAlert error={deliveriesQuery.error} /> : null}
        <RecordList rows={deliveries as unknown as Array<Record<string, unknown>>} empty="Delivery history не загружена." />
      </Stack>
    </Card>
  );
}

function VideoSection({
  propertyId,
  invalidate,
  reportError,
  run,
}: {
  propertyId: string;
  invalidate: () => void;
  reportError: ReportApiError;
  run: (action: () => void) => void;
}) {
  const [providerStatus, setProviderStatus] = useState<VideoProviderStatus | ''>('');
  const [providerName, setProviderName] = useState('');
  const [providerKind, setProviderKind] = useState<VideoProviderKind>('generic_link');
  const [providerBaseUrl, setProviderBaseUrl] = useState('');
  const [providerAuthRef, setProviderAuthRef] = useState('');
  const [providerCapabilities, setProviderCapabilities] = useState('clips,snapshots');
  const [cameraId, setCameraId] = useState('');
  const [videoProviderId, setVideoProviderId] = useState('');
  const [providerCameraId, setProviderCameraId] = useState('');
  const [accessPointId, setAccessPointId] = useState('');
  const [incidentId, setIncidentId] = useState('');
  const [visitLogId, setVisitLogId] = useState('');
  const [evidenceId, setEvidenceId] = useState('');
  const [evidenceType, setEvidenceType] = useState<VideoEvidenceType>('clip');
  const [evidenceStatus, setEvidenceStatus] = useState<VideoEvidenceStatus>('linked');
  const [sensitivity, setSensitivity] = useState<VideoEvidenceSensitivity>('restricted');
  const [evidenceTitle, setEvidenceTitle] = useState('');
  const [clipUrl, setClipUrl] = useState('');
  const [metadataJson, setMetadataJson] = useState('{"source":"integration_operations_ui"}');

  const providersQuery = useQuery({
    queryKey: ['v1', 'integrations', 'video', 'providers', propertyId, providerStatus],
    queryFn: ({ signal }) => api.videoEvidence.listProviders({
      property_id: propertyId,
      status: providerStatus || undefined,
    }, { signal }),
  });
  const camerasQuery = useQuery({
    queryKey: ['v1', 'integrations', 'video', 'cameras', propertyId, accessPointId],
    queryFn: ({ signal }) => api.videoEvidence.listCameras({
      property_id: propertyId,
      access_point_id: accessPointId.trim() || undefined,
    }, { signal }),
  });
  const evidenceQuery = useQuery({
    queryKey: ['v1', 'integrations', 'video', 'evidence', propertyId, evidenceId],
    enabled: false,
    queryFn: ({ signal }) => api.videoEvidence.getById(requiredTrim(evidenceId, 'evidence ID'), { property_id: propertyId }, { signal }),
  });
  const createProvider = useMutation({
    mutationFn: () => api.videoEvidence.createProvider({
      property_id: propertyId,
      provider: providerKind,
      display_name: requiredTrim(providerName, 'display name video provider'),
      status: 'active',
      base_url: providerBaseUrl.trim() || null,
      auth_ref: providerAuthRef.trim() || null,
      capabilities: requiredList(providerCapabilities, 'video capabilities'),
      config_json: { source: 'integration_operations_ui' },
    }),
    onSuccess: invalidate,
    onError: (error) => reportError(error, 'Не удалось создать video provider'),
  });
  const linkCamera = useMutation({
    mutationFn: () => api.videoEvidence.linkCameraProvider(requiredTrim(cameraId, 'camera ID'), {
      property_id: propertyId,
      video_provider_config_id: requiredTrim(videoProviderId, 'video provider ID'),
      provider_camera_id: providerCameraId.trim() || null,
    }),
    onSuccess: invalidate,
    onError: (error) => reportError(error, 'Не удалось связать camera provider'),
  });
  const createEvidence = useMutation({
    mutationFn: () => {
      const anchor = incidentId.trim()
        ? { access_incident_id: incidentId.trim() }
        : { visit_log_id: requiredTrim(visitLogId, 'incident ID или visit log ID') };
      return api.videoEvidence.create({
        property_id: propertyId,
        ...anchor,
        camera_device_id: cameraId.trim() || null,
        video_provider_config_id: videoProviderId.trim() || null,
        evidence_type: evidenceType,
        source: 'manual',
        status: evidenceStatus,
        title: evidenceTitle.trim() || null,
        clip_url: clipUrl.trim() || null,
        sensitivity,
        metadata: parseJsonObject(metadataJson, { source: 'integration_operations_ui' }),
      });
    },
    onSuccess: invalidate,
    onError: (error) => reportError(error, 'Не удалось создать video evidence'),
  });

  const providers = providersQuery.data?.providers ?? [];
  const cameras = camerasQuery.data?.cameras ?? [];

  return (
    <Card title="Video evidence" subtitle="Video providers, camera linkage и evidence references.">
      <Stack>
        {providersQuery.isError ? <QueryAlert error={providersQuery.error} /> : null}
        <div className={uiClasses.formGrid}>
          <Field label="Provider status">
            <Select value={providerStatus} onChange={(e) => setProviderStatus(e.target.value as VideoProviderStatus | '')}>
              {VIDEO_STATUSES.map((item) => <option key={item || 'all'} value={item}>{item || 'Все'}</option>)}
            </Select>
          </Field>
          <Button variant="ghost" loading={providersQuery.isFetching} onClick={() => void providersQuery.refetch()}>
            Обновить video
          </Button>
        </div>
        {providersQuery.isLoading ? <LoadingLine>Загрузка video providers…</LoadingLine> : null}
        <RecordList rows={providers as unknown as Array<Record<string, unknown>>} empty="Video providers не настроены." />

        <section aria-label="Video provider form">
          <h3 className={uiClasses.cardTitle}>Новый video provider</h3>
          <div className={uiClasses.formGrid}>
            <Field label="Provider">
              <Select value={providerKind} onChange={(e) => setProviderKind(e.target.value as VideoProviderKind)}>
                {VIDEO_PROVIDERS.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Field>
            <Field label="Display name">
              <Input value={providerName} onChange={(e) => setProviderName(e.target.value)} placeholder="Gate cameras" />
            </Field>
            <Field label="Base URL">
              <Input value={providerBaseUrl} onChange={(e) => setProviderBaseUrl(e.target.value)} placeholder="https://video-gateway.example" />
            </Field>
            <Field label="Auth ref">
              <Input value={providerAuthRef} onChange={(e) => setProviderAuthRef(e.target.value)} placeholder="vault://video/main" />
            </Field>
            <Field label="Capabilities">
              <Input value={providerCapabilities} onChange={(e) => setProviderCapabilities(e.target.value)} />
            </Field>
            <Button loading={createProvider.isPending} onClick={() => createProvider.mutate()}>Создать video provider</Button>
          </div>
        </section>

        <section aria-label="Video cameras">
          <h3 className={uiClasses.cardTitle}>Cameras</h3>
          <div className={uiClasses.formGrid}>
            <Field label="Access point ID">
              <Input value={accessPointId} onChange={(e) => setAccessPointId(e.target.value)} placeholder="point-uuid" />
            </Field>
            <Button variant="ghost" loading={camerasQuery.isFetching} onClick={() => void camerasQuery.refetch()}>
              Обновить cameras
            </Button>
          </div>
          <RecordList rows={cameras as unknown as Array<Record<string, unknown>>} empty="Камеры не найдены." />
          <div className={uiClasses.formGrid}>
            <Field label="Camera ID">
              <Input value={cameraId} onChange={(e) => setCameraId(e.target.value)} placeholder="camera-uuid" />
            </Field>
            <Field label="Video provider ID">
              <Input value={videoProviderId} onChange={(e) => setVideoProviderId(e.target.value)} placeholder="video-provider-uuid" />
            </Field>
            <Field label="Provider camera ID">
              <Input value={providerCameraId} onChange={(e) => setProviderCameraId(e.target.value)} placeholder="cam-1" />
            </Field>
            <Button variant="secondary" loading={linkCamera.isPending} onClick={() => linkCamera.mutate()}>Link camera</Button>
          </div>
        </section>

        <section aria-label="Video evidence references">
          <h3 className={uiClasses.cardTitle}>Evidence references</h3>
          <div className={uiClasses.formGrid}>
            <Field label="Incident ID">
              <Input value={incidentId} onChange={(e) => setIncidentId(e.target.value)} placeholder="incident-uuid" />
            </Field>
            <Field label="Visit log ID">
              <Input value={visitLogId} onChange={(e) => setVisitLogId(e.target.value)} placeholder="visit-log-uuid" />
            </Field>
            <Field label="Evidence type">
              <Select value={evidenceType} onChange={(e) => setEvidenceType(e.target.value as VideoEvidenceType)}>
                {VIDEO_EVIDENCE_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Field>
            <Field label="Status">
              <Select value={evidenceStatus} onChange={(e) => setEvidenceStatus(e.target.value as VideoEvidenceStatus)}>
                {VIDEO_EVIDENCE_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Field>
            <Field label="Sensitivity">
              <Select value={sensitivity} onChange={(e) => setSensitivity(e.target.value as VideoEvidenceSensitivity)}>
                {VIDEO_SENSITIVITY.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Field>
            <Field label="Title">
              <Input value={evidenceTitle} onChange={(e) => setEvidenceTitle(e.target.value)} placeholder="Gate clip" />
            </Field>
            <Field label="Clip URL">
              <Input value={clipUrl} onChange={(e) => setClipUrl(e.target.value)} placeholder="https://video.example/clip.mp4" />
            </Field>
            <Field label="Metadata JSON">
              <Textarea value={metadataJson} onChange={(e) => setMetadataJson(e.target.value)} rows={3} />
            </Field>
          </div>
          <Inline>
            <Button variant="secondary" loading={createEvidence.isPending} onClick={() => run(() => createEvidence.mutate())}>Создать evidence</Button>
            <Field label="Evidence ID">
              <Input value={evidenceId} onChange={(e) => setEvidenceId(e.target.value)} placeholder="evidence-uuid" />
            </Field>
            <Button variant="ghost" loading={evidenceQuery.isFetching} onClick={() => run(() => {
              requiredTrim(evidenceId, 'evidence ID');
              void evidenceQuery.refetch();
            })}>Загрузить evidence</Button>
          </Inline>
          {evidenceQuery.isError ? <QueryAlert error={evidenceQuery.error} /> : null}
          {evidenceQuery.data ? <RecordList rows={[evidenceQuery.data.evidence as unknown as Record<string, unknown>]} empty="" /> : null}
        </section>
      </Stack>
    </Card>
  );
}

function RecordList({ rows, empty }: { rows: Array<Record<string, unknown>>; empty: string }) {
  if (!rows.length) return empty ? <EmptyState>{empty}</EmptyState> : null;
  return (
    <ul className={uiClasses.resourceList}>
      {rows.map((row, index) => (
        <li className={uiClasses.resourceRow} key={recordLabel(row, ['id'], String(index))}>
          <div className={uiClasses.resourceRowMain}>
            <p className={uiClasses.resourceTitle}>
              {recordLabel(row, ['display_name', 'name', 'title', 'id'], `record-${index + 1}`)}
            </p>
            <p className={uiClasses.resourceMeta}>{summarizeRecord(row)}</p>
          </div>
          {row.status ? <Badge>{String(row.status)}</Badge> : null}
        </li>
      ))}
    </ul>
  );
}

function QueryAlert({ error }: { error: unknown }) {
  return (
    <Alert tone="error">
      Не удалось загрузить интеграции: {isV1ApiError(error) ? error.message : 'неизвестная ошибка'}
    </Alert>
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
