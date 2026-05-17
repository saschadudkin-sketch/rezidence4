/**
 * Property access administration screen.
 *
 * DH-19 baseline: topology, policies, vehicle flags and incident review in one
 * property-scoped workspace.  The page is intentionally dense because property
 * admins use it as an operational console, not as a marketing surface.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AccessPolicyDecision,
  AccessPolicyTemplate,
} from '../api/accessPolicies';
import type {
  AccessIncident,
  AccessPoint,
  AccessPointType,
  AccessPolicy,
  AccessPolicyApprovalMode,
  AccessPolicyEffect,
  AccessPolicyMethod,
  AccessPolicySubjectType,
  AccessZone,
  AccessZoneType,
  AdminPassListItem,
  GuardAuthorizedDevice,
  IncidentStatus,
  IncidentType,
  OverrideType,
  Pass,
  PinCredential,
  QrToken,
  PassStatus,
  PassType,
  Severity,
  SubjectType,
  UUID,
  Vehicle,
  VehicleKind,
  VehicleOwnerType,
} from '../api/types';
import type { VideoEvidenceReference } from '../api/videoEvidence';
import { accessIncidentsApi } from '../api/accessIncidents';
import { accessPoliciesApi } from '../api/accessPolicies';
import { accessTopologyApi } from '../api/accessTopology';
import { passesApi } from '../api/passes';
import { securityWorkspaceApi } from '../api/securityWorkspace';
import { normalizePlate, vehiclesApi } from '../api/vehicles';
import { isV1ApiError } from '../api';
import { useV1Session } from '../store';
import { getPropertyLabels } from '../lib/propertyLabels';
import {
  formatDateTime,
  formatIncidentType,
  formatPassStatus,
  formatPassType,
  formatSeverity,
  formatWindow,
  passStatusTone,
  severityTone,
} from '../components/formatters';
import { VehicleCard } from '../components/VehicleCard';
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

type AdminTab = 'passes' | 'topology' | 'policies' | 'vehicles' | 'incidents' | 'devices';

const ZONE_TYPES: AccessZoneType[] = [
  'perimeter',
  'checkpoint',
  'residential_entry',
  'parking',
  'guest_parking',
  'resident_parking',
  'public_area',
  'technical_area',
  'service_area',
  'street',
  'sector',
];

const POINT_TYPES: AccessPointType[] = [
  'gate',
  'barrier',
  'door',
  'turnstile',
  'wicket',
  'intercom',
  'checkpoint',
  'service_gate',
];

const SUBJECT_TYPES: AccessPolicySubjectType[] = [
  'resident',
  'guest',
  'staff',
  'contractor',
  'contractor_user',
  'vehicle',
  'courier',
];

const PASS_STATUSES: Array<PassStatus | ''> = ['', 'active', 'used', 'expired', 'blocked', 'revoked'];
const MANAGED_PASS_TYPES: Array<PassType | ''> = ['', 'guest', 'vehicle', 'courier', 'service', 'contractor', 'resident', 'staff', 'emergency'];
const PASS_SUBJECT_TYPES: SubjectType[] = ['guest', 'resident', 'staff', 'contractor_user', 'vehicle'];
const PASS_PAGE_LIMIT = 25;
const VEHICLE_OWNER_TYPES: VehicleOwnerType[] = ['resident', 'staff', 'contractor', 'guest'];
const VEHICLE_KINDS: VehicleKind[] = ['car', 'truck', 'motorcycle', 'service_vehicle'];
const INCIDENT_TYPES: IncidentType[] = [
  'expired_pass_attempt',
  'invalid_qr',
  'invalid_pin',
  'invalid_plate',
  'blacklist_hit',
  'outside_time_window',
  'unauthorized_vehicle',
  'manual_override',
  'provider_conflict',
  'suspicious_repeat_attempt',
  'policy_denied',
  'policy_security_review_required',
];
const INCIDENT_SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical'];
const INCIDENT_STATUS_ACTIONS: Exclude<IncidentStatus, 'open'>[] = ['investigating', 'resolved', 'dismissed'];
const OVERRIDE_TYPES: OverrideType[] = ['manual_admit', 'manual_deny', 'temporary_whitelist', 'temporary_block'];
const POLICY_METHODS: AccessPolicyMethod[] = ['qr', 'manual', 'plate', 'ble', 'card', 'pin'];
const POLICY_EFFECTS: AccessPolicyEffect[] = [
  'allow',
  'deny',
  'needs_approval',
  'needs_security_review',
  'incident_required',
];
const APPROVAL_MODES: AccessPolicyApprovalMode[] = ['auto', 'required', 'security_only', 'admin_only'];

const TAB_LABELS: Record<AdminTab, string> = {
  passes: 'Пропуска',
  topology: 'КПП и зоны',
  policies: 'Политики',
  vehicles: 'Авто',
  incidents: 'Инциденты',
  devices: 'Устройства охраны',
};

const ZONE_LABELS: Record<AccessZoneType, string> = {
  perimeter: 'Периметр',
  checkpoint: 'КПП',
  residential_entry: 'Жилой вход',
  parking: 'Парковка',
  guest_parking: 'Гостевая парковка',
  resident_parking: 'Парковка резидентов',
  public_area: 'Общая зона',
  technical_area: 'Техническая зона',
  service_area: 'Сервисная зона',
  street: 'Улица',
  sector: 'Сектор',
};

const POINT_LABELS: Record<AccessPointType, string> = {
  gate: 'Ворота',
  barrier: 'Шлагбаум',
  door: 'Дверь',
  turnstile: 'Турникет',
  wicket: 'Калитка',
  intercom: 'Домофон',
  checkpoint: 'КПП',
  service_gate: 'Сервисный въезд',
};

const CREDENTIAL_LABELS: Record<string, string> = {
  qr: 'QR',
  pin: 'PIN',
  plate: 'Номер',
  ble: 'BLE',
  card: 'Карта',
};

function policyEffectTone(effect: AccessPolicyEffect): 'success' | 'error' | 'warning' | 'info' | 'neutral' {
  if (effect === 'allow') return 'success';
  if (effect === 'deny') return 'error';
  if (effect === 'needs_security_review' || effect === 'incident_required') return 'warning';
  return 'info';
}

function policyScope(policy: AccessPolicy, zones: AccessZone[], points: AccessPoint[]): string {
  const point = points.find((item) => item.id === policy.point_id);
  if (point) return `Точка: ${point.name}`;
  const zone = zones.find((item) => item.id === policy.zone_id);
  if (zone) return `Зона: ${zone.name}`;
  return 'Весь объект';
}

function incidentStatusTone(status: IncidentStatus): 'success' | 'error' | 'warning' | 'info' | 'neutral' {
  if (status === 'resolved') return 'success';
  if (status === 'dismissed') return 'neutral';
  if (status === 'investigating') return 'warning';
  return 'error';
}

export function AccessAdminPage() {
  const session = useV1Session();
  const labels = useMemo(() => getPropertyLabels(session.property_type), [session.property_type]);
  const propertyId = session.property_id ?? null;
  const [tab, setTab] = useState<AdminTab>('passes');

  if (!propertyId) {
    return (
      <div className={uiClasses.pageShell}>
        <Alert tone="error">
          Не удалось определить объект. Проверьте привязку администратора к property.
        </Alert>
      </div>
    );
  }

  return (
    <div className={uiClasses.pageShell}>
      <header className={uiClasses.pageHeader}>
        <h1 className={uiClasses.pageTitle}>Настройки доступа</h1>
        <p className={uiClasses.pageSubtitle}>
          {labels.propertyKind}: активные пропуска, КПП, правила допуска, автофлаги и инциденты.
        </p>
      </header>

      <div className={uiClasses.tabs} role="tablist" aria-label="Разделы настроек доступа">
        {(Object.keys(TAB_LABELS) as AdminTab[]).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            className={`${uiClasses.tab} ${tab === item ? uiClasses.tabActive : ''}`}
            onClick={() => setTab(item)}
          >
            {TAB_LABELS[item]}
          </button>
        ))}
      </div>

      {tab === 'passes' ? <PassesTab propertyId={propertyId} /> : null}
      {tab === 'topology' ? <TopologyTab propertyId={propertyId} /> : null}
      {tab === 'policies' ? <PoliciesTab propertyId={propertyId} /> : null}
      {tab === 'vehicles' ? <VehicleFlagsTab propertyId={propertyId} /> : null}
      {tab === 'incidents' ? <IncidentsTab propertyId={propertyId} /> : null}
      {tab === 'devices' ? <GuardDevicesTab propertyId={propertyId} /> : null}
    </div>
  );
}

function passSubjectLabel(pass: AdminPassListItem): string {
  return pass.visitor_name
    || pass.vehicle_plate
    || pass.resident_name
    || `${formatPassType(pass.pass_type)} ${pass.id.slice(0, 8)}`;
}

function passResidentLine(pass: AdminPassListItem): string {
  const parts = [
    pass.resident_name,
    pass.unit_number ? `юнит ${pass.unit_number}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Резидент/юнит не указаны';
}

function passAccessLine(pass: AdminPassListItem): string {
  const parts = [
    pass.access_point_name ? `точка ${pass.access_point_name}` : null,
    pass.access_zone_name ? `зона ${pass.access_zone_name}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Вся доступная зона';
}

function passAvailability(pass: AdminPassListItem): {
  label: string;
  tone: 'success' | 'error' | 'warning' | 'info' | 'neutral';
} {
  if (pass.status !== 'active') {
    return { label: formatPassStatus(pass.status), tone: passStatusTone(pass.status) };
  }
  const now = Date.now();
  const startsAt = Date.parse(pass.valid_from);
  if (!Number.isNaN(startsAt) && startsAt > now) {
    return { label: `Запланирован с ${formatDateTime(pass.valid_from)}`, tone: 'info' };
  }
  const endsAt = Date.parse(pass.valid_until);
  if (!Number.isNaN(endsAt) && endsAt <= now) {
    return { label: 'Окно истекло', tone: 'warning' };
  }
  return { label: formatPassStatus(pass.status), tone: 'success' };
}

function PassesTab({ propertyId }: { propertyId: UUID }) {
  const [passes, setPasses] = useState<AdminPassListItem[]>([]);
  const [status, setStatus] = useState<PassStatus | ''>('active');
  const [passType, setPassType] = useState<PassType | ''>('');
  const [query, setQuery] = useState('');
  const [revokeReasons, setRevokeReasons] = useState<Record<UUID, string>>({});
  const [createPassType, setCreatePassType] = useState<PassType>('guest');
  const [createSubjectType, setCreateSubjectType] = useState<SubjectType>('guest');
  const [subjectResidentId, setSubjectResidentId] = useState('');
  const [subjectStaffId, setSubjectStaffId] = useState('');
  const [subjectContractorUserId, setSubjectContractorUserId] = useState('');
  const [subjectVehicleId, setSubjectVehicleId] = useState('');
  const [accessRequestId, setAccessRequestId] = useState('');
  const [passZoneId, setPassZoneId] = useState('');
  const [passPointId, setPassPointId] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [detailPass, setDetailPass] = useState<Pass | null>(null);
  const [qr, setQr] = useState<QrToken | null>(null);
  const [pin, setPin] = useState<PinCredential | null>(null);
  const [operationMessage, setOperationMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [savingId, setSavingId] = useState<UUID | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async ({ append = false, offset = 0 }: { append?: boolean; offset?: number } = {}) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await passesApi.list({
        property_id: propertyId,
        status: status || undefined,
        pass_type: passType || undefined,
        q: query.trim() || undefined,
        limit: PASS_PAGE_LIMIT,
        offset,
      });
      setPasses((prev) => (append ? [...prev, ...res.passes] : res.passes));
      setHasMore(res.page?.hasMore ?? res.passes.length === PASS_PAGE_LIMIT);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось загрузить пропуска');
    } finally {
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  }, [passType, propertyId, query, status]);

  useEffect(() => {
    void load({ offset: 0 });
  }, [load]);

  async function createPass() {
    if (!validFrom.trim() || !validUntil.trim()) {
      setError('Укажите окно действия пропуска');
      return;
    }
    setSavingId('create-pass' as UUID);
    setError(null);
    setOperationMessage(null);
    try {
      const res = await passesApi.create({
        property_id: propertyId,
        pass_type: createPassType,
        subject_type: createSubjectType,
        subject_resident_id: subjectResidentId.trim() || null,
        subject_staff_id: subjectStaffId.trim() || null,
        subject_contractor_user_id: subjectContractorUserId.trim() || null,
        subject_vehicle_id: subjectVehicleId.trim() || null,
        zone_id: passZoneId.trim() || null,
        point_id: passPointId.trim() || null,
        valid_from: validFrom.trim(),
        valid_until: validUntil.trim(),
        access_request_id: accessRequestId.trim() || null,
      });
      setDetailPass(res.pass);
      setOperationMessage(`Пропуск создан: ${res.pass.id}`);
      setValidFrom('');
      setValidUntil('');
      await load({ offset: 0 });
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось создать пропуск');
    } finally {
      setSavingId(null);
    }
  }

  async function loadPassDetail(pass: AdminPassListItem) {
    setSavingId(pass.id);
    setError(null);
    setOperationMessage(null);
    try {
      const res = await passesApi.getById(pass.id);
      setDetailPass(res.pass);
      setQr(res.qr);
      setPin(null);
      setOperationMessage(`Загружен пропуск ${res.pass.id.slice(0, 8)}`);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось загрузить пропуск');
    } finally {
      setSavingId(null);
    }
  }

  async function loadQr(pass: AdminPassListItem) {
    setSavingId(pass.id);
    setError(null);
    try {
      const res = await passesApi.getQr(pass.id);
      setQr(res.qr);
      setOperationMessage(`QR загружен для ${pass.id.slice(0, 8)}`);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось загрузить QR');
    } finally {
      setSavingId(null);
    }
  }

  async function regenerateQr(pass: AdminPassListItem) {
    setSavingId(pass.id);
    setError(null);
    try {
      const res = await passesApi.regenerateQr(pass.id);
      setQr(res.qr);
      setOperationMessage(`QR перевыпущен для ${pass.id.slice(0, 8)}`);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось перевыпустить QR');
    } finally {
      setSavingId(null);
    }
  }

  async function loadPin(pass: AdminPassListItem) {
    setSavingId(pass.id);
    setError(null);
    try {
      const res = await passesApi.getPin(pass.id);
      setPin(res.pin);
      setOperationMessage(`PIN загружен для ${pass.id.slice(0, 8)}`);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось загрузить PIN');
    } finally {
      setSavingId(null);
    }
  }

  async function regeneratePin(pass: AdminPassListItem) {
    setSavingId(pass.id);
    setError(null);
    try {
      const res = await passesApi.regeneratePin(pass.id);
      setPin(res.pin);
      setOperationMessage(`PIN перевыпущен для ${pass.id.slice(0, 8)}`);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось перевыпустить PIN');
    } finally {
      setSavingId(null);
    }
  }

  async function revokePass(pass: AdminPassListItem) {
    const reason = (revokeReasons[pass.id] || '').trim();
    if (!reason) {
      setError('Укажите причину отзыва пропуска');
      return;
    }
    setSavingId(pass.id);
    setError(null);
    try {
      await passesApi.revoke(pass.id, reason);
      await load({ offset: 0 });
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось отозвать пропуск');
    } finally {
      setSavingId(null);
    }
  }

  async function blockPass(pass: AdminPassListItem) {
    const reason = (revokeReasons[pass.id] || '').trim() || 'Blocked from access admin';
    setSavingId(pass.id);
    setError(null);
    try {
      await passesApi.block(pass.id, reason);
      await load({ offset: 0 });
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось заблокировать пропуск');
    } finally {
      setSavingId(null);
    }
  }

  async function unblockPass(pass: AdminPassListItem) {
    const reason = (revokeReasons[pass.id] || '').trim();
    if (!reason) {
      setError('Укажите причину разблокировки пропуска');
      return;
    }
    setSavingId(pass.id);
    setError(null);
    try {
      await passesApi.unblock(pass.id, { reason });
      await load({ offset: 0 });
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось разблокировать пропуск');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <Stack>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {operationMessage ? <Alert tone="success">{operationMessage}</Alert> : null}
      <Card title="Новый пропуск" subtitle="Прямое создание /api/v1/passes для админских восстановительных сценариев.">
        <div className={uiClasses.formGrid}>
          <Field label="Тип пропуска">
            <Select value={createPassType} onChange={(e) => setCreatePassType(e.target.value as PassType)}>
              {MANAGED_PASS_TYPES.filter(Boolean).map((item) => (
                <option key={item} value={item}>{formatPassType(item as PassType)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Субъект">
            <Select value={createSubjectType} onChange={(e) => setCreateSubjectType(e.target.value as SubjectType)}>
              {PASS_SUBJECT_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
            </Select>
          </Field>
          <Field label="Resident ID">
            <Input value={subjectResidentId} onChange={(e) => setSubjectResidentId(e.target.value)} placeholder="resident-uuid" />
          </Field>
          <Field label="Staff ID">
            <Input value={subjectStaffId} onChange={(e) => setSubjectStaffId(e.target.value)} placeholder="staff-uuid" />
          </Field>
          <Field label="Contractor user ID">
            <Input value={subjectContractorUserId} onChange={(e) => setSubjectContractorUserId(e.target.value)} placeholder="contractor-user-uuid" />
          </Field>
          <Field label="Vehicle ID">
            <Input value={subjectVehicleId} onChange={(e) => setSubjectVehicleId(e.target.value)} placeholder="vehicle-uuid" />
          </Field>
          <Field label="Zone ID">
            <Input value={passZoneId} onChange={(e) => setPassZoneId(e.target.value)} placeholder="zone-uuid" />
          </Field>
          <Field label="Point ID">
            <Input value={passPointId} onChange={(e) => setPassPointId(e.target.value)} placeholder="point-uuid" />
          </Field>
          <Field label="Access request ID">
            <Input value={accessRequestId} onChange={(e) => setAccessRequestId(e.target.value)} placeholder="request-uuid" />
          </Field>
          <Field label="Действует с">
            <Input value={validFrom} onChange={(e) => setValidFrom(e.target.value)} placeholder="2026-05-17T09:00:00.000Z" />
          </Field>
          <Field label="Действует до">
            <Input value={validUntil} onChange={(e) => setValidUntil(e.target.value)} placeholder="2026-05-17T18:00:00.000Z" />
          </Field>
        </div>
        <Button loading={savingId === ('create-pass' as UUID)} onClick={() => void createPass()}>
          Создать пропуск
        </Button>
      </Card>
      <Card
        title="Управление пропусками"
        subtitle="Поиск по гостю, резиденту, юниту, авто или ID пропуска."
        actions={<Button variant="ghost" onClick={() => void load({ offset: 0 })} loading={loading}>Обновить</Button>}
      >
        <div className={uiClasses.formGrid}>
          <Field label="Поиск">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Иванов, 125, A001AA77"
            />
          </Field>
          <Field label="Статус">
            <Select value={status} onChange={(e) => setStatus(e.target.value as PassStatus | '')}>
              {PASS_STATUSES.map((item) => (
                <option key={item || 'all'} value={item}>
                  {item ? formatPassStatus(item) : 'Все статусы'}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Тип">
            <Select value={passType} onChange={(e) => setPassType(e.target.value as PassType | '')}>
              {MANAGED_PASS_TYPES.map((item) => (
                <option key={item || 'all'} value={item}>
                  {item ? formatPassType(item) : 'Все типы'}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {loading ? <LoadingLine>Загрузка пропусков…</LoadingLine> : null}
        {!loading && passes.length === 0 ? <EmptyState>Пропусков по фильтру нет.</EmptyState> : null}
        <ul className={uiClasses.resourceList}>
          {passes.map((pass) => {
            const availability = passAvailability(pass);
            return (
              <li key={pass.id} className={uiClasses.resourceRow}>
                <div className={uiClasses.resourceRowMain}>
                  <Inline>
                    <h3 className={uiClasses.resourceTitle}>{passSubjectLabel(pass)}</h3>
                    <Badge tone={availability.tone}>{availability.label}</Badge>
                    <Badge tone="info">{formatPassType(pass.pass_type)}</Badge>
                  </Inline>
                  <div className={uiClasses.resourceMeta}>
                    <span>{formatWindow(pass.valid_from, pass.valid_until)}</span>
                    <span>{passResidentLine(pass)}</span>
                    <span>{passAccessLine(pass)}</span>
                    {pass.request_type ? <span>{pass.request_type}</span> : null}
                    <span>ID {pass.id.slice(0, 8)}</span>
                  </div>
                  {pass.credential_types?.length ? (
                    <Inline>
                      {pass.credential_types.map((type) => (
                        <Badge key={type} tone="neutral">{CREDENTIAL_LABELS[type] ?? type}</Badge>
                      ))}
                    </Inline>
                  ) : null}
                  {pass.guest_instructions ? (
                    <p className={uiClasses.textMuted}>Инструкция гостю: {pass.guest_instructions}</p>
                  ) : null}
                  {pass.guard_notes ? (
                    <p className={uiClasses.textMuted}>Заметка охране: {pass.guard_notes}</p>
                  ) : null}
                  {pass.revoked_reason ? (
                    <p className={uiClasses.textMuted}>Причина отзыва: {pass.revoked_reason}</p>
                  ) : null}
                  <Inline>
                    <Button variant="ghost" loading={savingId === pass.id} onClick={() => void loadPassDetail(pass)}>
                      Деталь
                    </Button>
                    <Button variant="ghost" loading={savingId === pass.id} onClick={() => void loadQr(pass)}>
                      QR
                    </Button>
                    <Button variant="ghost" loading={savingId === pass.id} onClick={() => void regenerateQr(pass)}>
                      Перевыпустить QR
                    </Button>
                    <Button variant="ghost" loading={savingId === pass.id} onClick={() => void loadPin(pass)}>
                      PIN
                    </Button>
                    <Button variant="ghost" loading={savingId === pass.id} onClick={() => void regeneratePin(pass)}>
                      Перевыпустить PIN
                    </Button>
                  </Inline>
                  {pass.status === 'active' || pass.status === 'blocked' ? (
                    <div className={uiClasses.formGrid}>
                      <Field label="Причина">
                        <Input
                          value={revokeReasons[pass.id] ?? ''}
                          onChange={(e) => setRevokeReasons((prev) => ({ ...prev, [pass.id]: e.target.value }))}
                          placeholder="Например, отмена визита"
                        />
                      </Field>
                      <Inline>
                        {pass.status === 'active' ? (
                          <>
                            <Button
                              variant="danger"
                              loading={savingId === pass.id}
                              onClick={() => void revokePass(pass)}
                            >
                              Отозвать
                            </Button>
                            <Button
                              variant="secondary"
                              loading={savingId === pass.id}
                              onClick={() => void blockPass(pass)}
                            >
                              Заблокировать
                            </Button>
                          </>
                        ) : null}
                        {pass.status === 'blocked' ? (
                          <Button
                            variant="secondary"
                            loading={savingId === pass.id}
                            onClick={() => void unblockPass(pass)}
                          >
                            Разблокировать
                          </Button>
                        ) : null}
                      </Inline>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        {!loading && hasMore ? (
          <Button
            variant="secondary"
            loading={loadingMore}
            onClick={() => void load({ append: true, offset: passes.length })}
          >
            Загрузить ещё
          </Button>
        ) : null}
      </Card>
      {detailPass || qr || pin ? (
        <Card title="Деталь и credentials">
          {detailPass ? (
            <div className={uiClasses.resourceMeta}>
              <span>ID {detailPass.id}</span>
              <span>{formatPassStatus(detailPass.status)}</span>
              <span>{formatWindow(detailPass.valid_from, detailPass.valid_until)}</span>
            </div>
          ) : null}
          {qr ? (
            <p className={uiClasses.textMuted}>
              QR: {'token' in qr ? String(qr.token) : JSON.stringify(qr)}
            </p>
          ) : null}
          {pin ? (
            <p className={uiClasses.textMuted}>
              PIN: {'value' in pin ? String(pin.value) : JSON.stringify(pin)}
            </p>
          ) : null}
        </Card>
      ) : null}
    </Stack>
  );
}

function TopologyTab({ propertyId }: { propertyId: UUID }) {
  const [zones, setZones] = useState<AccessZone[]>([]);
  const [points, setPoints] = useState<AccessPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<UUID | null>(null);
  const [zoneName, setZoneName] = useState('');
  const [zoneType, setZoneType] = useState<AccessZoneType>('perimeter');
  const [zoneDescription, setZoneDescription] = useState('');
  const [selectedPointId, setSelectedPointId] = useState<UUID | null>(null);
  const [pointName, setPointName] = useState('');
  const [pointType, setPointType] = useState<AccessPointType>('barrier');
  const [pointZoneId, setPointZoneId] = useState<UUID | ''>('');
  const [pointProvider, setPointProvider] = useState('');
  const [pointProviderExternalId, setPointProviderExternalId] = useState('');
  const [pointDescription, setPointDescription] = useState('');
  const [saving, setSaving] = useState<'zone' | 'point' | 'deactivate' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [zoneRes, pointRes] = await Promise.all([
        accessTopologyApi.listZones({ property_id: propertyId, is_active: true, limit: 100 }),
        accessTopologyApi.listPoints({ property_id: propertyId, is_active: true, limit: 200 }),
      ]);
      setZones(zoneRes.zones);
      setPoints(pointRes.points);
      setPointZoneId((prev) => (prev && zoneRes.zones.some((z) => z.id === prev) ? prev : zoneRes.zones[0]?.id ?? ''));
      setSelectedZoneId((prev) => (prev && zoneRes.zones.some((zone) => zone.id === prev) ? prev : null));
      setSelectedPointId((prev) => (prev && pointRes.points.some((point) => point.id === prev) ? prev : null));
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось загрузить топологию');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  function clearZoneForm() {
    setSelectedZoneId(null);
    setZoneName('');
    setZoneType('perimeter');
    setZoneDescription('');
  }

  function selectZone(zone: AccessZone) {
    setSelectedZoneId(zone.id);
    setZoneName(zone.name);
    setZoneType(zone.zone_type);
    setZoneDescription(zone.description ?? '');
    setError(null);
  }

  function clearPointForm() {
    setSelectedPointId(null);
    setPointName('');
    setPointType('barrier');
    setPointZoneId(zones[0]?.id ?? '');
    setPointProvider('');
    setPointProviderExternalId('');
    setPointDescription('');
  }

  function selectPoint(point: AccessPoint) {
    setSelectedPointId(point.id);
    setPointName(point.name);
    setPointType(point.point_type);
    setPointZoneId(point.zone_id);
    setPointProvider(point.provider ?? '');
    setPointProviderExternalId(point.provider_external_id ?? '');
    setPointDescription(point.description ?? '');
    setError(null);
  }

  async function createZone() {
    if (!zoneName.trim()) {
      setError('Название зоны обязательно');
      return;
    }
    setSaving('zone');
    setError(null);
    try {
      await accessTopologyApi.createZone({
        property_id: propertyId,
        name: zoneName.trim(),
        zone_type: zoneType,
        description: zoneDescription.trim() || null,
      });
      clearZoneForm();
      await load();
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось создать зону');
    } finally {
      setSaving(null);
    }
  }

  async function updateZone() {
    if (!selectedZoneId) {
      setError('Выберите зону для обновления');
      return;
    }
    if (!zoneName.trim()) {
      setError('Название зоны обязательно');
      return;
    }
    setSaving('zone');
    setError(null);
    try {
      await accessTopologyApi.updateZone(selectedZoneId, {
        name: zoneName.trim(),
        zone_type: zoneType,
        description: zoneDescription.trim() || null,
      });
      await load();
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось обновить зону');
    } finally {
      setSaving(null);
    }
  }

  async function deactivateZone(id: UUID) {
    setSaving('deactivate');
    setError(null);
    try {
      await accessTopologyApi.deactivateZone(id);
      if (selectedZoneId === id) clearZoneForm();
      if (pointZoneId === id) clearPointForm();
      await load();
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось отключить зону');
    } finally {
      setSaving(null);
    }
  }

  async function createPoint() {
    if (!pointZoneId) {
      setError('Выберите зону для точки доступа');
      return;
    }
    if (!pointName.trim()) {
      setError('Название точки обязательно');
      return;
    }
    setSaving('point');
    setError(null);
    try {
      await accessTopologyApi.createPoint({
        property_id: propertyId,
        zone_id: pointZoneId,
        name: pointName.trim(),
        point_type: pointType,
        provider: pointProvider.trim() || null,
        provider_external_id: pointProviderExternalId.trim() || null,
        description: pointDescription.trim() || null,
      });
      clearPointForm();
      await load();
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось создать точку доступа');
    } finally {
      setSaving(null);
    }
  }

  async function updatePoint() {
    if (!selectedPointId) {
      setError('Выберите точку для обновления');
      return;
    }
    if (!pointZoneId) {
      setError('Выберите зону для точки доступа');
      return;
    }
    if (!pointName.trim()) {
      setError('Название точки обязательно');
      return;
    }
    setSaving('point');
    setError(null);
    try {
      await accessTopologyApi.updatePoint(selectedPointId, {
        zone_id: pointZoneId,
        name: pointName.trim(),
        point_type: pointType,
        provider: pointProvider.trim() || null,
        provider_external_id: pointProviderExternalId.trim() || null,
        description: pointDescription.trim() || null,
      });
      await load();
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось обновить точку доступа');
    } finally {
      setSaving(null);
    }
  }

  async function deactivatePoint(id: UUID) {
    setSaving('deactivate');
    setError(null);
    try {
      await accessTopologyApi.deactivatePoint(id);
      if (selectedPointId === id) clearPointForm();
      await load();
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось отключить точку');
    } finally {
      setSaving(null);
    }
  }

  return (
    <Stack>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className={uiClasses.twoColumn}>
        <Card title={selectedZoneId ? 'Редактирование зоны доступа' : 'Новая зона доступа'}>
          <div className={uiClasses.formGrid}>
            <Field label="Название">
              <Input value={zoneName} onChange={(e) => setZoneName(e.target.value)} placeholder="Периметр" />
            </Field>
            <Field label="Тип">
              <Select value={zoneType} onChange={(e) => setZoneType(e.target.value as AccessZoneType)}>
                {ZONE_TYPES.map((item) => (
                  <option key={item} value={item}>{ZONE_LABELS[item]}</option>
                ))}
              </Select>
            </Field>
            <Field label="Описание" className={uiClasses.formGridWide}>
              <Textarea
                value={zoneDescription}
                onChange={(e) => setZoneDescription(e.target.value)}
                placeholder="Например, внешний контур КПП"
              />
            </Field>
          </div>
          <Inline>
            <Button loading={saving === 'zone'} onClick={createZone}>Создать зону</Button>
            <Button variant="secondary" loading={saving === 'zone'} onClick={updateZone} disabled={!selectedZoneId}>
              Обновить зону
            </Button>
            {selectedZoneId ? (
              <Button variant="ghost" onClick={clearZoneForm}>Сбросить</Button>
            ) : null}
          </Inline>
        </Card>

        <Card title={selectedPointId ? 'Редактирование точки доступа' : 'Новая точка доступа'}>
          <div className={uiClasses.formGrid}>
            <Field label="Зона">
              <Select value={pointZoneId} onChange={(e) => setPointZoneId(e.target.value as UUID | '')}>
                {zones.length === 0 ? <option value="">Сначала создайте зону</option> : null}
                {zones.map((zone) => (
                  <option key={zone.id} value={zone.id}>{zone.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Тип">
              <Select value={pointType} onChange={(e) => setPointType(e.target.value as AccessPointType)}>
                {POINT_TYPES.map((item) => (
                  <option key={item} value={item}>{POINT_LABELS[item]}</option>
                ))}
              </Select>
            </Field>
            <Field label="Название">
              <Input value={pointName} onChange={(e) => setPointName(e.target.value)} placeholder="КПП 1" />
            </Field>
            <Field label="Провайдер">
              <Input value={pointProvider} onChange={(e) => setPointProvider(e.target.value)} placeholder="Bolid / Hikvision" />
            </Field>
            <Field label="Внешний ID">
              <Input
                value={pointProviderExternalId}
                onChange={(e) => setPointProviderExternalId(e.target.value)}
                placeholder="door-1"
              />
            </Field>
            <Field label="Описание" className={uiClasses.formGridWide}>
              <Textarea
                value={pointDescription}
                onChange={(e) => setPointDescription(e.target.value)}
                placeholder="Например, въездной шлагбаум"
              />
            </Field>
          </div>
          <Inline>
            <Button loading={saving === 'point'} onClick={createPoint} disabled={zones.length === 0}>
              Создать точку
            </Button>
            <Button variant="secondary" loading={saving === 'point'} onClick={updatePoint} disabled={!selectedPointId || zones.length === 0}>
              Обновить точку
            </Button>
            {selectedPointId ? (
              <Button variant="ghost" onClick={clearPointForm}>Сбросить</Button>
            ) : null}
          </Inline>
        </Card>
      </div>

      <Card
        title="Активная топология"
        actions={<Button variant="ghost" onClick={() => void load()} loading={loading}>Обновить</Button>}
      >
        {loading ? <LoadingLine>Загрузка топологии…</LoadingLine> : null}
        {!loading && zones.length === 0 ? <EmptyState>Зоны доступа ещё не заведены.</EmptyState> : null}
        <ul className={uiClasses.resourceList}>
          {zones.map((zone) => {
            const zonePoints = points.filter((point) => point.zone_id === zone.id);
            return (
              <li key={zone.id} className={uiClasses.resourceRow}>
                <div className={uiClasses.resourceRowMain}>
                  <h3 className={uiClasses.resourceTitle}>{zone.name}</h3>
                  <div className={uiClasses.resourceMeta}>
                    <span>{ZONE_LABELS[zone.zone_type]}</span>
                    <span>{zone.description || 'Без описания'}</span>
                    <span>{zonePoints.length} точек</span>
                  </div>
                  {zonePoints.length > 0 ? (
                    <ul className={`${uiClasses.resourceList} ${uiClasses.marginTop3}`}>
                      {zonePoints.map((point) => (
                        <li key={point.id} className={uiClasses.resourceRow}>
                          <div className={uiClasses.resourceRowMain}>
                            <h4 className={uiClasses.resourceTitle}>{point.name}</h4>
                            <div className={uiClasses.resourceMeta}>
                              <span>{POINT_LABELS[point.point_type]}</span>
                              <span>{point.provider || 'Без провайдера'}</span>
                              {point.provider_external_id ? <span>{point.provider_external_id}</span> : null}
                            </div>
                          </div>
                          <Inline>
                            <Button variant="ghost" onClick={() => selectPoint(point)}>
                              Редактировать точку
                            </Button>
                            <Button
                              variant="ghost"
                              loading={saving === 'deactivate'}
                              onClick={() => void deactivatePoint(point.id)}
                            >
                              Отключить точку
                            </Button>
                          </Inline>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <Inline>
                  <Button variant="ghost" onClick={() => selectZone(zone)}>
                    Редактировать зону
                  </Button>
                  <Button
                    variant="ghost"
                    loading={saving === 'deactivate'}
                    onClick={() => void deactivateZone(zone.id)}
                  >
                    Отключить зону
                  </Button>
                </Inline>
              </li>
            );
          })}
        </ul>
      </Card>
    </Stack>
  );
}

function GuardDevicesTab({ propertyId }: { propertyId: UUID }) {
  const [devices, setDevices] = useState<GuardAuthorizedDevice[]>([]);
  const [points, setPoints] = useState<AccessPoint[]>([]);
  const [status, setStatus] = useState<'pending' | 'active' | 'revoked' | ''>('pending');
  const [revokeReasons, setRevokeReasons] = useState<Record<UUID, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<UUID | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pointById = useMemo(() => new Map(points.map((point) => [point.id, point])), [points]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [deviceRes, pointRes] = await Promise.all([
        securityWorkspaceApi.listAuthorizedDevices({
          property_id: propertyId,
          status: status || undefined,
          limit: 100,
        }),
        accessTopologyApi.listPoints({ property_id: propertyId, is_active: true, limit: 200 }),
      ]);
      setDevices(deviceRes.guard_authorized_devices);
      setPoints(pointRes.points);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось загрузить устройства охраны');
    } finally {
      setLoading(false);
    }
  }, [propertyId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revokeDevice(device: GuardAuthorizedDevice) {
    const reason = (revokeReasons[device.id] || '').trim();
    if (!reason) {
      setError('Укажите причину отзыва устройства');
      return;
    }
    setSavingId(device.id);
    setError(null);
    try {
      await securityWorkspaceApi.revokeAuthorizedDevice(device.id, {
        property_id: propertyId,
        reason,
      });
      await load();
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось отозвать устройство');
    } finally {
      setSavingId(null);
    }
  }

  async function approveDevice(device: GuardAuthorizedDevice) {
    setSavingId(device.id);
    setError(null);
    try {
      await securityWorkspaceApi.approveAuthorizedDevice(device.id, {
        property_id: propertyId,
      });
      await load();
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось подтвердить устройство');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <Stack>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Card
        title="Авторизованные устройства КПП"
        subtitle="Allow-list устройств, которым разрешены ручные решения охраны при включенном флаге."
        actions={<Button variant="ghost" onClick={() => void load()} loading={loading}>Обновить</Button>}
      >
        <Field label="Статус">
          <Select value={status} onChange={(e) => setStatus(e.target.value as 'pending' | 'active' | 'revoked' | '')}>
            <option value="">Все</option>
            <option value="pending">На подтверждении</option>
            <option value="active">Активные</option>
            <option value="revoked">Отозванные</option>
          </Select>
        </Field>

        {loading ? <LoadingLine>Загрузка устройств…</LoadingLine> : null}
        {!loading && devices.length === 0 ? <EmptyState>Устройства охраны ещё не авторизованы.</EmptyState> : null}
        <ul className={uiClasses.resourceList}>
          {devices.map((device) => {
            const point = device.access_point_id ? pointById.get(device.access_point_id) : null;
            return (
              <li key={device.id} className={uiClasses.resourceRow}>
                <div className={uiClasses.resourceRowMain}>
                  <Inline>
                    <h3 className={uiClasses.resourceTitle}>{device.label}</h3>
                    <Badge tone={device.status === 'active' ? 'success' : (device.status === 'pending' ? 'warning' : 'neutral')}>
                      {device.status === 'active' ? 'Активно' : (device.status === 'pending' ? 'На подтверждении' : 'Отозвано')}
                    </Badge>
                  </Inline>
                  <div className={uiClasses.resourceMeta}>
                    <span>{point ? point.name : 'Весь объект'}</span>
                    <span>ID {device.id.slice(0, 8)}</span>
                    {device.device_fingerprint_preview ? <span>Fingerprint {device.device_fingerprint_preview}</span> : null}
                    <span>Последний раз: {formatDateTime(device.last_seen_at)}</span>
                    {device.approved_at ? <span>Подтверждено: {formatDateTime(device.approved_at)}</span> : null}
                    {device.revoked_at ? <span>Отозвано: {formatDateTime(device.revoked_at)}</span> : null}
                  </div>
                  {device.status === 'pending' ? (
                    <Inline>
                      <Button
                        variant="primary"
                        loading={savingId === device.id}
                        onClick={() => void approveDevice(device)}
                      >
                        Подтвердить устройство
                      </Button>
                    </Inline>
                  ) : null}
                  {device.status === 'active' ? (
                    <div className={uiClasses.formGrid}>
                      <Field label="Причина отзыва">
                        <Input
                          value={revokeReasons[device.id] ?? ''}
                          onChange={(e) => setRevokeReasons((prev) => ({ ...prev, [device.id]: e.target.value }))}
                          placeholder="Например, устройство потеряно"
                        />
                      </Field>
                      <Button
                        variant="danger"
                        loading={savingId === device.id}
                        onClick={() => void revokeDevice(device)}
                      >
                        Отозвать устройство
                      </Button>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </Stack>
  );
}

function PoliciesTab({ propertyId }: { propertyId: UUID }) {
  const [zones, setZones] = useState<AccessZone[]>([]);
  const [points, setPoints] = useState<AccessPoint[]>([]);
  const [policies, setPolicies] = useState<AccessPolicy[]>([]);
  const [templates, setTemplates] = useState<AccessPolicyTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPolicyId, setSelectedPolicyId] = useState<UUID | null>(null);
  const [policyDetail, setPolicyDetail] = useState<AccessPolicy | null>(null);
  const [name, setName] = useState('');
  const [subjectType, setSubjectType] = useState<AccessPolicySubjectType>('vehicle');
  const [method, setMethod] = useState<AccessPolicyMethod>('plate');
  const [effect, setEffect] = useState<AccessPolicyEffect>('allow');
  const [approvalMode, setApprovalMode] = useState<AccessPolicyApprovalMode>('auto');
  const [zoneId, setZoneId] = useState<UUID | ''>('');
  const [pointId, setPointId] = useState<UUID | ''>('');
  const [priority, setPriority] = useState('50');
  const [duration, setDuration] = useState('');
  const [passType, setPassType] = useState('');
  const [decision, setDecision] = useState<AccessPolicyDecision | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [zoneRes, pointRes, policyRes, templateRes] = await Promise.all([
        accessTopologyApi.listZones({ property_id: propertyId, is_active: true, limit: 100 }),
        accessTopologyApi.listPoints({ property_id: propertyId, is_active: true, limit: 200 }),
        accessPoliciesApi.list({ property_id: propertyId, is_active: true, limit: 100 }),
        accessPoliciesApi.templates({ property_id: propertyId }),
      ]);
      setZones(zoneRes.zones);
      setPoints(pointRes.points);
      setPolicies(policyRes.policies);
      setTemplates(templateRes.templates);
      setSelectedPolicyId((prev) => (prev && policyRes.policies.some((policy) => policy.id === prev) ? prev : null));
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось загрузить политики');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  function clearPolicyForm() {
    setSelectedPolicyId(null);
    setPolicyDetail(null);
    setName('');
    setSubjectType('vehicle');
    setMethod('plate');
    setEffect('allow');
    setApprovalMode('auto');
    setZoneId('');
    setPointId('');
    setPriority('50');
    setDuration('');
    setPassType('');
    setDecision(null);
    setError(null);
  }

  function applyPolicy(policy: AccessPolicy) {
    setSelectedPolicyId(policy.id);
    setPolicyDetail(policy);
    setName(policy.name);
    setSubjectType(policy.subject_type);
    setMethod(policy.access_method);
    setEffect(policy.effect);
    setApprovalMode(policy.approval_mode);
    setZoneId(policy.zone_id ?? '');
    setPointId(policy.point_id ?? '');
    setPriority(String(policy.priority));
    setDuration(policy.duration_minutes ? String(policy.duration_minutes) : '');
    setError(null);
  }

  function applyTemplate(template: AccessPolicyTemplate) {
    setSelectedPolicyId(null);
    setPolicyDetail(null);
    setName(template.name);
    setSubjectType(template.subject_type);
    setMethod(template.access_method);
    setEffect(template.effect ?? 'allow');
    setApprovalMode(template.approval_mode ?? 'auto');
    setZoneId(template.zone_id ?? '');
    setPointId(template.point_id ?? '');
    setPriority(String(template.priority ?? 50));
    setDuration(template.duration_minutes ? String(template.duration_minutes) : '');
    setDecision(null);
    setError(null);
  }

  function buildPolicyPayload() {
    if (!name.trim()) {
      setError('Название политики обязательно');
      return null;
    }
    const parsedPriority = Number(priority);
    if (!Number.isInteger(parsedPriority)) {
      setError('Приоритет должен быть целым числом');
      return null;
    }
    const parsedDuration = duration.trim() ? Number(duration) : null;
    if (parsedDuration !== null && (!Number.isInteger(parsedDuration) || parsedDuration <= 0)) {
      setError('Длительность должна быть положительным числом минут');
      return null;
    }
    return {
      name: name.trim(),
      subject_type: subjectType,
      access_method: method,
      effect,
      approval_mode: approvalMode,
      priority: parsedPriority,
      zone_id: zoneId || null,
      point_id: pointId || null,
      duration_minutes: parsedDuration,
      is_recurring: parsedDuration === null,
      metadata: { source: 'access_admin_ui' },
    };
  }

  async function createPolicy() {
    const payload = buildPolicyPayload();
    if (!payload) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await accessPoliciesApi.create({
        property_id: propertyId,
        ...payload,
      });
      clearPolicyForm();
      await load();
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось создать политику');
    } finally {
      setSaving(false);
    }
  }

  async function loadPolicy(id: UUID) {
    setSaving(true);
    setError(null);
    try {
      const res = await accessPoliciesApi.getById(id);
      applyPolicy(res.policy);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось загрузить политику');
    } finally {
      setSaving(false);
    }
  }

  async function updatePolicy() {
    if (!selectedPolicyId) {
      setError('Выберите политику для обновления');
      return;
    }
    const payload = buildPolicyPayload();
    if (!payload) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await accessPoliciesApi.update(selectedPolicyId, payload);
      applyPolicy(res.policy);
      await load();
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось обновить политику');
    } finally {
      setSaving(false);
    }
  }

  async function evaluatePolicy() {
    setSaving(true);
    setError(null);
    setDecision(null);
    try {
      const res = await accessPoliciesApi.evaluate({
        property_id: propertyId,
        subject_type: subjectType,
        pass_type: passType.trim() || null,
        access_method: method,
        zone_id: zoneId || null,
        point_id: pointId || null,
      });
      setDecision(res.decision);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось оценить политику');
    } finally {
      setSaving(false);
    }
  }

  async function deactivatePolicy(id: UUID) {
    setSaving(true);
    setError(null);
    try {
      await accessPoliciesApi.deactivate(id);
      if (selectedPolicyId === id) clearPolicyForm();
      await load();
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось отключить политику');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Card title="Шаблоны политик">
        {templates.length === 0 ? <EmptyState>Шаблоны политик недоступны.</EmptyState> : null}
        {templates.length > 0 ? (
          <ul className={uiClasses.resourceList}>
            {templates.map((template) => (
              <li key={template.key} className={uiClasses.resourceRow}>
                <div className={uiClasses.resourceRowMain}>
                  <h3 className={uiClasses.resourceTitle}>{template.name}</h3>
                  <div className={uiClasses.resourceMeta}>
                    <span>{template.subject_type}</span>
                    <span>{template.access_method}</span>
                    <span>{template.effect ?? 'allow'}</span>
                    <span>priority {template.priority ?? 50}</span>
                  </div>
                </div>
                <Button variant="ghost" onClick={() => applyTemplate(template)}>
                  Применить шаблон
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card title={selectedPolicyId ? 'Редактирование политики доступа' : 'Новая политика доступа'}>
        <div className={uiClasses.formGrid}>
          <Field label="Название">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Гостевой въезд через КПП" />
          </Field>
          <Field label="Субъект">
            <Select value={subjectType} onChange={(e) => setSubjectType(e.target.value as AccessPolicySubjectType)}>
              {SUBJECT_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
            </Select>
          </Field>
          <Field label="Метод">
            <Select value={method} onChange={(e) => setMethod(e.target.value as AccessPolicyMethod)}>
              {POLICY_METHODS.map((item) => <option key={item} value={item}>{item}</option>)}
            </Select>
          </Field>
          <Field label="Эффект">
            <Select value={effect} onChange={(e) => setEffect(e.target.value as AccessPolicyEffect)}>
              {POLICY_EFFECTS.map((item) => <option key={item} value={item}>{item}</option>)}
            </Select>
          </Field>
          <Field label="Согласование">
            <Select value={approvalMode} onChange={(e) => setApprovalMode(e.target.value as AccessPolicyApprovalMode)}>
              {APPROVAL_MODES.map((item) => <option key={item} value={item}>{item}</option>)}
            </Select>
          </Field>
          <Field label="Приоритет">
            <Input value={priority} onChange={(e) => setPriority(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Зона">
            <Select
              value={zoneId}
              onChange={(e) => {
                setZoneId(e.target.value as UUID | '');
                setPointId('');
              }}
            >
              <option value="">Весь объект</option>
              {zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
            </Select>
          </Field>
          <Field label="Точка">
            <Select value={pointId} onChange={(e) => setPointId(e.target.value as UUID | '')}>
              <option value="">Любая точка</option>
              {points
                .filter((point) => !zoneId || point.zone_id === zoneId)
                .map((point) => <option key={point.id} value={point.id}>{point.name}</option>)}
            </Select>
          </Field>
          <Field label="Длительность, мин">
            <Input value={duration} onChange={(e) => setDuration(e.target.value)} inputMode="numeric" placeholder="Пусто = recurring" />
          </Field>
          <Field label="Тип пропуска">
            <Input value={passType} onChange={(e) => setPassType(e.target.value)} placeholder="guest / resident" />
          </Field>
        </div>
        <Inline>
          <Button loading={saving} onClick={createPolicy}>Создать политику</Button>
          <Button variant="secondary" loading={saving} onClick={updatePolicy} disabled={!selectedPolicyId}>
            Обновить политику
          </Button>
          <Button variant="secondary" loading={saving} onClick={evaluatePolicy}>
            Оценить политику
          </Button>
          {selectedPolicyId ? (
            <Button variant="ghost" onClick={clearPolicyForm}>Сбросить</Button>
          ) : null}
        </Inline>
        {policyDetail ? (
          <div className={`${uiClasses.resourceMeta} ${uiClasses.marginTop3}`}>
            <span>ID {policyDetail.id}</span>
            <span>{policyDetail.is_active ? 'active' : 'inactive'}</span>
            <span>{policyDetail.updated_at ? `updated ${formatDateTime(policyDetail.updated_at)}` : 'not updated'}</span>
          </div>
        ) : null}
        {decision ? (
          <Alert tone={decision.allowed ? 'success' : 'warning'}>
            {decision.decision}: {decision.reason}
            {decision.matched_policy_name ? ` · ${decision.matched_policy_name}` : ''}
          </Alert>
        ) : null}
      </Card>

      <Card
        title="Активные политики"
        actions={<Button variant="ghost" onClick={() => void load()} loading={loading}>Обновить</Button>}
      >
        {loading ? <LoadingLine>Загрузка политик…</LoadingLine> : null}
        {!loading && policies.length === 0 ? <EmptyState>Активных политик нет.</EmptyState> : null}
        <ul className={uiClasses.resourceList}>
          {policies.map((policy) => (
            <li key={policy.id} className={uiClasses.resourceRow}>
              <div className={uiClasses.resourceRowMain}>
                <Inline>
                  <h3 className={uiClasses.resourceTitle}>{policy.name}</h3>
                  <Badge tone={policyEffectTone(policy.effect)}>{policy.effect}</Badge>
                </Inline>
                <div className={uiClasses.resourceMeta}>
                  <span>{policy.subject_type}</span>
                  <span>{policy.access_method}</span>
                  <span>{policy.approval_mode}</span>
                  <span>priority {policy.priority}</span>
                  <span>{policyScope(policy, zones, points)}</span>
                  <span>{policy.duration_minutes ? `${policy.duration_minutes} мин` : 'recurring'}</span>
                </div>
              </div>
              <Inline>
                <Button
                  variant="ghost"
                  loading={saving}
                  onClick={() => void loadPolicy(policy.id)}
                >
                  Редактировать политику
                </Button>
                <Button
                  variant="ghost"
                  loading={saving}
                  onClick={() => void deactivatePolicy(policy.id)}
                >
                  Отключить политику
                </Button>
              </Inline>
            </li>
          ))}
        </ul>
      </Card>
    </Stack>
  );
}

function VehicleFlagsTab({ propertyId }: { propertyId: UUID }) {
  const [input, setInput] = useState('');
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleId, setVehicleId] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [ownerType, setOwnerType] = useState<VehicleOwnerType>('resident');
  const [ownerResidentId, setOwnerResidentId] = useState('');
  const [ownerStaffId, setOwnerStaffId] = useState('');
  const [ownerContractorUserId, setOwnerContractorUserId] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleKind>('car');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [color, setColor] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const normalized = useMemo(() => normalizePlate(input), [input]);

  function applyVehicle(next: Vehicle) {
    setVehicle(next);
    setVehicleId(next.id);
    setPlateNumber(next.plate_number);
    setOwnerType(next.owner_type);
    setOwnerResidentId(next.owner_resident_id ?? '');
    setOwnerStaffId(next.owner_staff_id ?? '');
    setOwnerContractorUserId(next.owner_contractor_user_id ?? '');
    setVehicleType(next.vehicle_type);
    setBrand(next.brand ?? '');
    setModel(next.model ?? '');
    setColor(next.color ?? '');
    setNotes(next.notes ?? '');
  }

  async function search() {
    if (!normalized) {
      setError('Введите номер авто');
      return;
    }
    setLoading(true);
    setError(null);
    setVehicle(null);
    try {
      const res = await vehiclesApi.getByPlate(normalized);
      applyVehicle(res.vehicle);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось найти авто');
    } finally {
      setLoading(false);
    }
  }

  async function listVehicles() {
    setSaving('list');
    setError(null);
    try {
      const res = await vehiclesApi.list({
        property_id: propertyId,
        plate: plateNumber.trim() || undefined,
        owner_type: ownerType || undefined,
        limit: 10,
      });
      setVehicles(res.vehicles);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось загрузить авто');
    } finally {
      setSaving(null);
    }
  }

  async function loadById() {
    const id = vehicleId.trim();
    if (!id) {
      setError('Укажите Vehicle ID');
      return;
    }
    setSaving('detail');
    setError(null);
    try {
      const res = await vehiclesApi.getById(id);
      applyVehicle(res.vehicle);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось загрузить авто');
    } finally {
      setSaving(null);
    }
  }

  async function createVehicle() {
    if (!plateNumber.trim()) {
      setError('Укажите номер авто');
      return;
    }
    setSaving('create');
    setError(null);
    try {
      const res = await vehiclesApi.create({
        property_id: propertyId,
        plate_number: plateNumber.trim(),
        owner_type: ownerType,
        owner_resident_id: ownerResidentId.trim() || null,
        owner_staff_id: ownerStaffId.trim() || null,
        owner_contractor_user_id: ownerContractorUserId.trim() || null,
        vehicle_type: vehicleType,
        brand: brand.trim() || null,
        model: model.trim() || null,
        color: color.trim() || null,
        notes: notes.trim() || null,
      });
      applyVehicle(res.vehicle);
      setVehicles((current) => [res.vehicle, ...current.filter((item) => item.id !== res.vehicle.id)].slice(0, 10));
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось создать авто');
    } finally {
      setSaving(null);
    }
  }

  async function updateVehicle() {
    const id = vehicleId.trim();
    if (!id) {
      setError('Укажите Vehicle ID');
      return;
    }
    setSaving('update');
    setError(null);
    try {
      const res = await vehiclesApi.update(id, {
        vehicle_type: vehicleType,
        brand: brand.trim() || null,
        model: model.trim() || null,
        color: color.trim() || null,
        notes: notes.trim() || null,
      });
      applyVehicle(res.vehicle);
      setVehicles((current) => current.map((item) => (item.id === res.vehicle.id ? res.vehicle : item)));
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось обновить авто');
    } finally {
      setSaving(null);
    }
  }

  async function deleteVehicle() {
    const id = vehicleId.trim();
    if (!id) {
      setError('Укажите Vehicle ID');
      return;
    }
    setSaving('delete');
    setError(null);
    try {
      await vehiclesApi.delete(id);
      setVehicle(null);
      setVehicles((current) => current.filter((item) => item.id !== id));
      setVehicleId('');
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось удалить авто');
    } finally {
      setSaving(null);
    }
  }

  return (
    <Stack>
      <Card title="Проверка и флаги авто">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <Field label="Гос. номер" error={error}>
            <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="A001AA77" />
          </Field>
          <Inline>
            <Button type="submit" loading={loading}>Найти</Button>
            {input ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setInput('');
                  setVehicle(null);
                  setError(null);
                }}
              >
                Сбросить
              </Button>
            ) : null}
          </Inline>
        </form>
      </Card>
      <Card title="Операции с авто">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className={uiClasses.formGrid}>
          <Field label="Vehicle ID">
            <Input value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} placeholder="vehicle-uuid" />
          </Field>
          <Field label="Номер">
            <Input value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} placeholder="A001AA77" />
          </Field>
          <Field label="Владелец">
            <Select value={ownerType} onChange={(e) => setOwnerType(e.target.value as VehicleOwnerType)}>
              {VEHICLE_OWNER_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
            </Select>
          </Field>
          <Field label="Тип авто">
            <Select value={vehicleType} onChange={(e) => setVehicleType(e.target.value as VehicleKind)}>
              {VEHICLE_KINDS.map((item) => <option key={item} value={item}>{item}</option>)}
            </Select>
          </Field>
          <Field label="Resident owner ID">
            <Input value={ownerResidentId} onChange={(e) => setOwnerResidentId(e.target.value)} placeholder="resident-uuid" />
          </Field>
          <Field label="Staff owner ID">
            <Input value={ownerStaffId} onChange={(e) => setOwnerStaffId(e.target.value)} placeholder="staff-uuid" />
          </Field>
          <Field label="Contractor owner ID">
            <Input value={ownerContractorUserId} onChange={(e) => setOwnerContractorUserId(e.target.value)} placeholder="contractor-user-uuid" />
          </Field>
          <Field label="Марка">
            <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="BMW" />
          </Field>
          <Field label="Модель">
            <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="X5" />
          </Field>
          <Field label="Цвет">
            <Input value={color} onChange={(e) => setColor(e.target.value)} placeholder="Черный" />
          </Field>
          <Field label="Заметки">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Постоянный резидент" />
          </Field>
        </div>
        <Inline>
          <Button variant="secondary" loading={saving === 'list'} onClick={() => void listVehicles()}>
            Список авто
          </Button>
          <Button variant="secondary" loading={saving === 'detail'} onClick={() => void loadById()}>
            Загрузить авто
          </Button>
          <Button loading={saving === 'create'} onClick={() => void createVehicle()}>
            Создать авто
          </Button>
          <Button variant="secondary" loading={saving === 'update'} onClick={() => void updateVehicle()}>
            Обновить авто
          </Button>
          <Button variant="danger" loading={saving === 'delete'} onClick={() => void deleteVehicle()}>
            Удалить авто
          </Button>
        </Inline>
        {vehicles.length ? (
          <ul className={`${uiClasses.resourceList} ${uiClasses.marginTop3}`}>
            {vehicles.map((item) => (
              <li key={item.id} className={uiClasses.resourceRow}>
                <div className={uiClasses.resourceRowMain}>
                  <p className={uiClasses.resourceTitle}>{item.plate_number}</p>
                  <p className={uiClasses.resourceMeta}>{[item.brand, item.model, item.color].filter(Boolean).join(' · ') || item.owner_type}</p>
                </div>
                <Button variant="ghost" onClick={() => applyVehicle(item)}>Выбрать</Button>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
      {vehicle ? <VehicleCard vehicle={vehicle} onChanged={applyVehicle} /> : null}
    </Stack>
  );
}

function IncidentsTab({ propertyId }: { propertyId: UUID }) {
  const [status, setStatus] = useState<IncidentStatus | ''>('');
  const [incidents, setIncidents] = useState<AccessIncident[]>([]);
  const [selectedId, setSelectedId] = useState<UUID | null>(null);
  const [detail, setDetail] = useState<AccessIncident | null>(null);
  const [overrides, setOverrides] = useState<Array<{ id: UUID; override_type: OverrideType; reason: string; created_at: string }>>([]);
  const [overridePreview, setOverridePreview] = useState<string | null>(null);
  const [videoEvidence, setVideoEvidence] = useState<VideoEvidenceReference[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState<IncidentType>('manual_override');
  const [newSeverity, setNewSeverity] = useState<Severity>('medium');
  const [newDescription, setNewDescription] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editSeverity, setEditSeverity] = useState<Severity>('medium');
  const [assigneeId, setAssigneeId] = useState('');
  const [reason, setReason] = useState('');
  const [statusAction, setStatusAction] = useState<Exclude<IncidentStatus, 'open'>>('investigating');
  const [overrideType, setOverrideType] = useState<OverrideType>('manual_admit');
  const [overrideReason, setOverrideReason] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [cameraDeviceId, setCameraDeviceId] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await accessIncidentsApi.list({
        property_id: propertyId,
        status: status || undefined,
        limit: 100,
      });
      setIncidents(res.incidents);
      setSelectedId((prev) => (prev && res.incidents.some((incident) => incident.id === prev) ? prev : res.incidents[0]?.id ?? null));
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось загрузить инциденты');
    } finally {
      setLoading(false);
    }
  }, [propertyId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadDetail = useCallback(async (incidentId: UUID | null) => {
    if (!incidentId) {
      setDetail(null);
      setOverrides([]);
      setVideoEvidence([]);
      return;
    }
    setDetailLoading(true);
    setError(null);
    try {
      const [detailRes, overridesRes, evidenceRes] = await Promise.all([
        accessIncidentsApi.getById(incidentId),
        accessIncidentsApi.listOverrides({ property_id: propertyId, incident_id: incidentId, limit: 20 }),
        accessIncidentsApi.listVideoEvidence(incidentId),
      ]);
      setDetail(detailRes.incident);
      setEditTitle(detailRes.incident.title);
      setEditSeverity(detailRes.incident.severity);
      setOverrides(overridesRes.overrides);
      setVideoEvidence(evidenceRes.evidence);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось загрузить детали инцидента');
    } finally {
      setDetailLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    void loadDetail(selectedId);
  }, [loadDetail, selectedId]);

  async function createIncident() {
    if (!newTitle.trim()) {
      setError('Укажите заголовок инцидента');
      return;
    }
    setSaving('create');
    setError(null);
    try {
      const res = await accessIncidentsApi.create({
        property_id: propertyId,
        incident_type: newType,
        severity: newSeverity,
        title: newTitle.trim(),
        description: newDescription.trim() || null,
      });
      setNewTitle('');
      setNewDescription('');
      await load();
      setSelectedId(res.incident.id);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось создать инцидент');
    } finally {
      setSaving(null);
    }
  }

  async function patchIncident() {
    if (!selectedId) return;
    setSaving('patch');
    setError(null);
    try {
      await accessIncidentsApi.patch(selectedId, {
        title: editTitle.trim() || undefined,
        severity: editSeverity,
      });
      await load();
      await loadDetail(selectedId);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось обновить инцидент');
    } finally {
      setSaving(null);
    }
  }

  async function assignIncident() {
    if (!selectedId) return;
    if (!assigneeId.trim()) {
      setError('Укажите staff ID для назначения');
      return;
    }
    setSaving('assign');
    setError(null);
    try {
      await accessIncidentsApi.assign(selectedId, { assigned_to_staff_id: assigneeId.trim() });
      await load();
      await loadDetail(selectedId);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось назначить инцидент');
    } finally {
      setSaving(null);
    }
  }

  async function reasonAction(action: 'resolve' | 'dismiss' | 'reopen') {
    if (!selectedId) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setError('Укажите причину действия');
      return;
    }
    setSaving(action);
    setError(null);
    try {
      if (action === 'resolve') {
        await accessIncidentsApi.resolve(selectedId, { reason: trimmed });
      } else if (action === 'dismiss') {
        await accessIncidentsApi.dismiss(selectedId, { reason: trimmed });
      } else {
        await accessIncidentsApi.reopen(selectedId, { reason: trimmed, assigned_to_staff_id: assigneeId.trim() || undefined });
      }
      await load();
      await loadDetail(selectedId);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось выполнить действие с инцидентом');
    } finally {
      setSaving(null);
    }
  }

  async function updateIncidentStatus() {
    if (!selectedId) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setError('Укажите причину смены статуса');
      return;
    }
    setSaving('status');
    setError(null);
    try {
      await accessIncidentsApi.updateStatus(selectedId, {
        status: statusAction,
        reason: trimmed,
        assigned_to_staff_id: assigneeId.trim() || undefined,
      });
      await load();
      await loadDetail(selectedId);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось изменить статус инцидента');
    } finally {
      setSaving(null);
    }
  }

  async function createOverride() {
    if (!selectedId) return;
    const trimmed = overrideReason.trim();
    if (!trimmed) {
      setError('Укажите причину override');
      return;
    }
    setSaving('override');
    setError(null);
    try {
      await accessIncidentsApi.createOverride({
        property_id: propertyId,
        incident_id: selectedId,
        pass_id: detail?.related_pass_id ?? null,
        override_type: overrideType,
        reason: trimmed,
      });
      await loadDetail(selectedId);
      setOverrideReason('');
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось создать override');
    } finally {
      setSaving(null);
    }
  }

  async function previewOverride(id: UUID) {
    setSaving(`override-${id}`);
    setError(null);
    try {
      const res = await accessIncidentsApi.getOverride(id);
      setOverridePreview(`${res.override.override_type}: ${res.override.reason}`);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось загрузить override');
    } finally {
      setSaving(null);
    }
  }

  async function createVideoEvidence() {
    if (!selectedId) return;
    const trimmed = videoUrl.trim();
    if (!trimmed) {
      setError('Укажите URL видеофрагмента');
      return;
    }
    setSaving('video-create');
    setError(null);
    try {
      await accessIncidentsApi.createVideoEvidence(selectedId, {
        property_id: propertyId,
        clip_url: trimmed,
      });
      await loadDetail(selectedId);
      setVideoUrl('');
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось добавить видеофрагмент');
    } finally {
      setSaving(null);
    }
  }

  async function fetchVideoEvidence() {
    if (!selectedId) return;
    setSaving('video-fetch');
    setError(null);
    try {
      await accessIncidentsApi.fetchVideoEvidence(selectedId, {
        property_id: propertyId,
        camera_device_id: cameraDeviceId.trim() || null,
      });
      await loadDetail(selectedId);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось запросить видео у провайдера');
    } finally {
      setSaving(null);
    }
  }

  return (
    <Stack>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Card title="Новый инцидент доступа">
        <div className={uiClasses.formGrid}>
          <Field label="Заголовок">
            <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Ручной инцидент" />
          </Field>
          <Field label="Тип">
            <Select value={newType} onChange={(e) => setNewType(e.target.value as IncidentType)}>
              {INCIDENT_TYPES.map((item) => <option key={item} value={item}>{formatIncidentType(item)}</option>)}
            </Select>
          </Field>
          <Field label="Критичность">
            <Select value={newSeverity} onChange={(e) => setNewSeverity(e.target.value as Severity)}>
              {INCIDENT_SEVERITIES.map((item) => <option key={item} value={item}>{formatSeverity(item)}</option>)}
            </Select>
          </Field>
          <Field label="Описание">
            <Textarea value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Контекст для разбора" rows={3} />
          </Field>
        </div>
        <Button loading={saving === 'create'} onClick={() => void createIncident()}>Создать инцидент</Button>
      </Card>
      <Card
        title="Инциденты доступа"
        actions={<Button variant="ghost" onClick={() => void load()} loading={loading}>Обновить</Button>}
      >
        <Field label="Статус">
          <Select value={status} onChange={(e) => setStatus(e.target.value as IncidentStatus | '')}>
            <option value="">Открытые и в работе</option>
            <option value="open">open</option>
            <option value="investigating">investigating</option>
            <option value="resolved">resolved</option>
            <option value="dismissed">dismissed</option>
          </Select>
        </Field>
        {loading ? <LoadingLine>Загрузка инцидентов…</LoadingLine> : null}
        {!loading && incidents.length === 0 ? <EmptyState>Инцидентов по фильтру нет.</EmptyState> : null}
        <ul className={uiClasses.resourceList}>
          {incidents.map((incident) => (
            <li key={incident.id} className={uiClasses.resourceRow}>
              <div className={uiClasses.resourceRowMain}>
                <Inline>
                  <h3 className={uiClasses.resourceTitle}>{incident.title}</h3>
                  <Badge tone={incidentStatusTone(incident.status)}>{incident.status}</Badge>
                  <Badge tone={severityTone(incident.severity)}>{formatSeverity(incident.severity)}</Badge>
                </Inline>
                <div className={uiClasses.resourceMeta}>
                  <span>{formatIncidentType(incident.incident_type)}</span>
                  <span>{formatDateTime(incident.created_at)}</span>
                  {incident.related_visit_log_id ? <span>visit {incident.related_visit_log_id.slice(0, 8)}</span> : null}
                </div>
                {incident.description ? <p className={uiClasses.textMuted}>{incident.description}</p> : null}
              </div>
              <Button variant="secondary" onClick={() => setSelectedId(incident.id)}>
                Открыть
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      <Card
        title="Карточка инцидента"
        subtitle={detail ? `ID ${detail.id.slice(0, 8)}` : 'Выберите инцидент из списка'}
      >
        {detailLoading ? <LoadingLine>Загрузка карточки…</LoadingLine> : null}
        {!detailLoading && !detail ? <EmptyState>Инцидент не выбран.</EmptyState> : null}
        {detail ? (
          <Stack>
            <Inline>
              <Badge tone={incidentStatusTone(detail.status)}>{detail.status}</Badge>
              <Badge tone={severityTone(detail.severity)}>{formatSeverity(detail.severity)}</Badge>
              <Badge tone="info">{formatIncidentType(detail.incident_type)}</Badge>
            </Inline>
            <div className={uiClasses.resourceMeta}>
              <span>Создан: {formatDateTime(detail.created_at)}</span>
              {detail.assigned_to_staff_id ? <span>Назначен: {detail.assigned_to_staff_id}</span> : null}
              {detail.resolved_at ? <span>Закрыт: {formatDateTime(detail.resolved_at)}</span> : null}
              {detail.related_pass_id ? <span>pass {detail.related_pass_id.slice(0, 8)}</span> : null}
            </div>
            <div className={uiClasses.formGrid}>
              <Field label="Заголовок">
                <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
              </Field>
              <Field label="Критичность">
                <Select value={editSeverity} onChange={(e) => setEditSeverity(e.target.value as Severity)}>
                  {INCIDENT_SEVERITIES.map((item) => <option key={item} value={item}>{formatSeverity(item)}</option>)}
                </Select>
              </Field>
              <Button variant="secondary" loading={saving === 'patch'} onClick={() => void patchIncident()}>
                Сохранить карточку
              </Button>
            </div>

            <div className={uiClasses.formGrid}>
              <Field label="Staff ID">
                <Input value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} placeholder="staff-uuid" />
              </Field>
              <Button variant="secondary" loading={saving === 'assign'} onClick={() => void assignIncident()}>
                Назначить
              </Button>
              <Field label="Причина">
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Основание решения" />
              </Field>
              <Field label="Новый статус">
                <Select value={statusAction} onChange={(e) => setStatusAction(e.target.value as Exclude<IncidentStatus, 'open'>)}>
                  {INCIDENT_STATUS_ACTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                </Select>
              </Field>
            </div>
            <Inline>
              <Button variant="secondary" loading={saving === 'status'} onClick={() => void updateIncidentStatus()}>Сменить статус</Button>
              <Button variant="primary" loading={saving === 'resolve'} onClick={() => void reasonAction('resolve')}>Закрыть</Button>
              <Button variant="ghost" loading={saving === 'dismiss'} onClick={() => void reasonAction('dismiss')}>Отклонить</Button>
              <Button variant="secondary" loading={saving === 'reopen'} onClick={() => void reasonAction('reopen')}>Переоткрыть</Button>
            </Inline>

            <section aria-label="Overrides">
              <h3 className={uiClasses.cardTitle}>Overrides</h3>
              <div className={uiClasses.formGrid}>
                <Field label="Тип override">
                  <Select value={overrideType} onChange={(e) => setOverrideType(e.target.value as OverrideType)}>
                    {OVERRIDE_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
                  </Select>
                </Field>
                <Field label="Причина override">
                  <Input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Решение администратора" />
                </Field>
                <Button variant="secondary" loading={saving === 'override'} onClick={() => void createOverride()}>
                  Создать override
                </Button>
              </div>
              {overridePreview ? <Alert tone="info">{overridePreview}</Alert> : null}
              {!overrides.length ? <EmptyState>Override-решений нет.</EmptyState> : null}
              <ul className={uiClasses.resourceList}>
                {overrides.map((override) => (
                  <li key={override.id} className={uiClasses.resourceRow}>
                    <div className={uiClasses.resourceRowMain}>
                      <p className={uiClasses.resourceTitle}>{override.override_type}</p>
                      <p className={uiClasses.resourceMeta}>{override.reason} · {formatDateTime(override.created_at)}</p>
                    </div>
                    <Button
                      variant="ghost"
                      loading={saving === `override-${override.id}`}
                      onClick={() => void previewOverride(override.id)}
                    >
                      Проверить
                    </Button>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-label="Видео evidence">
              <h3 className={uiClasses.cardTitle}>Видео evidence</h3>
              <div className={uiClasses.formGrid}>
                <Field label="URL фрагмента">
                  <Input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://provider/clip.mp4" />
                </Field>
                <Button variant="secondary" loading={saving === 'video-create'} onClick={() => void createVideoEvidence()}>
                  Добавить видео
                </Button>
                <Field label="Camera device ID">
                  <Input value={cameraDeviceId} onChange={(e) => setCameraDeviceId(e.target.value)} placeholder="camera-uuid" />
                </Field>
                <Button variant="secondary" loading={saving === 'video-fetch'} onClick={() => void fetchVideoEvidence()}>
                  Запросить у провайдера
                </Button>
              </div>
              {!videoEvidence.length ? <EmptyState>Видео evidence нет.</EmptyState> : null}
              <ul className={uiClasses.resourceList}>
                {videoEvidence.map((item, index) => (
                  <li key={index} className={uiClasses.resourceRow}>
                    <div className={uiClasses.resourceRowMain}>
                      <p className={uiClasses.resourceTitle}>Evidence #{index + 1}</p>
                      <p className={uiClasses.resourceMeta}>{summarizeUnknown(item)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </Stack>
        ) : null}
      </Card>
    </Stack>
  );
}

function summarizeUnknown(value: unknown): string {
  if (!value || typeof value !== 'object') return String(value ?? '—');
  const record = value as Record<string, unknown>;
  const label = record.id || record.evidence_url || record.clip_url || record.status || 'record';
  return String(label);
}

function LoadingLine({ children }: { children: string }) {
  return (
    <Inline>
      <Spinner />
      <span className={uiClasses.textMuted}>{children}</span>
    </Inline>
  );
}
