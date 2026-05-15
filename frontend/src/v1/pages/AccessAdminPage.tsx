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
  IncidentStatus,
  UUID,
  Vehicle,
} from '../api/types';
import { accessIncidentsApi } from '../api/accessIncidents';
import { accessPoliciesApi } from '../api/accessPolicies';
import { accessTopologyApi } from '../api/accessTopology';
import { normalizePlate, vehiclesApi } from '../api/vehicles';
import { isV1ApiError } from '../api';
import { useV1Session } from '../store';
import { getPropertyLabels } from '../lib/propertyLabels';
import {
  formatDateTime,
  formatIncidentType,
  formatSeverity,
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

type AdminTab = 'topology' | 'policies' | 'vehicles' | 'incidents';

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
  topology: 'КПП и зоны',
  policies: 'Политики',
  vehicles: 'Авто',
  incidents: 'Инциденты',
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
  const [tab, setTab] = useState<AdminTab>('topology');

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
          {labels.propertyKind}: КПП, правила допуска, автофлаги и инциденты.
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

      {tab === 'topology' ? <TopologyTab propertyId={propertyId} /> : null}
      {tab === 'policies' ? <PoliciesTab propertyId={propertyId} /> : null}
      {tab === 'vehicles' ? <VehicleFlagsTab /> : null}
      {tab === 'incidents' ? <IncidentsTab /> : null}
    </div>
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
      setError('Priority должен быть целым числом');
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
          <Field label="Approval">
            <Select value={approvalMode} onChange={(e) => setApprovalMode(e.target.value as AccessPolicyApprovalMode)}>
              {APPROVAL_MODES.map((item) => <option key={item} value={item}>{item}</option>)}
            </Select>
          </Field>
          <Field label="Priority">
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
