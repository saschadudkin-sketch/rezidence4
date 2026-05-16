/**
 * Property access administration screen.
 *
 * DH-19 baseline: topology, policies, vehicle flags and incident review in one
 * property-scoped workspace.  The page is intentionally dense because property
 * admins use it as an operational console, not as a marketing surface.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  PassStatus,
  PassType,
  UUID,
  Vehicle,
} from '../api/types';
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
const PASS_PAGE_LIMIT = 25;
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
      {tab === 'vehicles' ? <VehicleFlagsTab /> : null}
      {tab === 'incidents' ? <IncidentsTab /> : null}
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

  return (
    <Stack>
      {error ? <Alert tone="error">{error}</Alert> : null}
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
                  {pass.status === 'active' ? (
                    <div className={uiClasses.formGrid}>
                      <Field label="Причина">
                        <Input
                          value={revokeReasons[pass.id] ?? ''}
                          onChange={(e) => setRevokeReasons((prev) => ({ ...prev, [pass.id]: e.target.value }))}
                          placeholder="Например, отмена визита"
                        />
                      </Field>
                      <Inline>
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
    </Stack>
  );
}

function TopologyTab({ propertyId }: { propertyId: UUID }) {
  const [zones, setZones] = useState<AccessZone[]>([]);
  const [points, setPoints] = useState<AccessPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoneName, setZoneName] = useState('');
  const [zoneType, setZoneType] = useState<AccessZoneType>('perimeter');
  const [zoneDescription, setZoneDescription] = useState('');
  const [pointName, setPointName] = useState('');
  const [pointType, setPointType] = useState<AccessPointType>('barrier');
  const [pointZoneId, setPointZoneId] = useState<UUID | ''>('');
  const [pointProvider, setPointProvider] = useState('');
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
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось загрузить топологию');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

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
      setZoneName('');
      setZoneDescription('');
      await load();
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось создать зону');
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
      });
      setPointName('');
      setPointProvider('');
      await load();
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось создать точку доступа');
    } finally {
      setSaving(null);
    }
  }

  async function deactivatePoint(id: UUID) {
    setSaving('deactivate');
    setError(null);
    try {
      await accessTopologyApi.deactivatePoint(id);
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
        <Card title="Новая зона доступа">
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
          <Button loading={saving === 'zone'} onClick={createZone}>Создать зону</Button>
        </Card>

        <Card title="Новая точка доступа">
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
          </div>
          <Button loading={saving === 'point'} onClick={createPoint} disabled={zones.length === 0}>
            Создать точку
          </Button>
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
                          <Button
                            variant="ghost"
                            loading={saving === 'deactivate'}
                            onClick={() => void deactivatePoint(point.id)}
                          >
                            Отключить
                          </Button>
                        </li>
                      ))}
                    </ul>
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [subjectType, setSubjectType] = useState<AccessPolicySubjectType>('vehicle');
  const [method, setMethod] = useState<AccessPolicyMethod>('plate');
  const [effect, setEffect] = useState<AccessPolicyEffect>('allow');
  const [approvalMode, setApprovalMode] = useState<AccessPolicyApprovalMode>('auto');
  const [zoneId, setZoneId] = useState<UUID | ''>('');
  const [pointId, setPointId] = useState<UUID | ''>('');
  const [priority, setPriority] = useState('50');
  const [duration, setDuration] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [zoneRes, pointRes, policyRes] = await Promise.all([
        accessTopologyApi.listZones({ property_id: propertyId, is_active: true, limit: 100 }),
        accessTopologyApi.listPoints({ property_id: propertyId, is_active: true, limit: 200 }),
        accessPoliciesApi.list({ property_id: propertyId, is_active: true, limit: 100 }),
      ]);
      setZones(zoneRes.zones);
      setPoints(pointRes.points);
      setPolicies(policyRes.policies);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось загрузить политики');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createPolicy() {
    if (!name.trim()) {
      setError('Название политики обязательно');
      return;
    }
    const parsedPriority = Number(priority);
    if (!Number.isInteger(parsedPriority)) {
      setError('Приоритет должен быть целым числом');
      return;
    }
    const parsedDuration = duration.trim() ? Number(duration) : null;
    if (parsedDuration !== null && (!Number.isInteger(parsedDuration) || parsedDuration <= 0)) {
      setError('Длительность должна быть положительным числом минут');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await accessPoliciesApi.create({
        property_id: propertyId,
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
      });
      setName('');
      setDuration('');
      await load();
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось создать политику');
    } finally {
      setSaving(false);
    }
  }

  async function deactivatePolicy(id: UUID) {
    setSaving(true);
    setError(null);
    try {
      await accessPoliciesApi.deactivate(id);
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
      <Card title="Новая политика доступа">
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
        </div>
        <Button loading={saving} onClick={createPolicy}>Создать политику</Button>
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
              <Button
                variant="ghost"
                loading={saving}
                onClick={() => void deactivatePolicy(policy.id)}
              >
                Отключить
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </Stack>
  );
}

function VehicleFlagsTab() {
  const [input, setInput] = useState('');
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalized = useMemo(() => normalizePlate(input), [input]);

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
      setVehicle(res.vehicle);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось найти авто');
    } finally {
      setLoading(false);
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
      {vehicle ? <VehicleCard vehicle={vehicle} onChanged={setVehicle} /> : null}
    </Stack>
  );
}

function IncidentsTab() {
  const [status, setStatus] = useState<IncidentStatus | ''>('');
  const [incidents, setIncidents] = useState<AccessIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await accessIncidentsApi.list({
        status: status || undefined,
        limit: 100,
      });
      setIncidents(res.incidents);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось загрузить инциденты');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Stack>
      {error ? <Alert tone="error">{error}</Alert> : null}
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
            </li>
          ))}
        </ul>
      </Card>
    </Stack>
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
