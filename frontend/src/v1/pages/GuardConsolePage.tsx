/**
 * GuardConsolePage - duty station for security / admin roles.
 *
 * The backend security-workspace API is the initial hydrate surface for this
 * page. SSE and scan/manual-decision callbacks only trigger incremental
 * refreshes; they do not own the initial feed shape.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  PropertyType,
  GuardAuthorizedDeviceContext,
  SecurityWorkspaceActivePass,
  SecurityWorkspaceBlacklistHit,
  SecurityWorkspaceBootstrap,
  SecurityWorkspaceExpectedGuest,
  SecurityWorkspacePassSearchRow,
  SecurityWorkspaceRecentEvent,
  SecurityWorkspaceResidentSearchRow,
  SecurityWorkspaceSearchResult,
  SecurityWorkspaceUnitSearchRow,
  SecurityWorkspaceVehicleSearchRow,
  UUID,
} from '../api/types';
import { api, isV1ApiError } from '../api';
import { useV1Session, isGuardRole, normalizeUserRole } from '../store';
import { ScanPanel } from '../components/ScanPanel';
import { getPropertyLabels, formatUnitLabel } from '../lib/propertyLabels';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Inline,
  Input,
  Spinner,
  Stack,
  uiClasses,
} from '../components/ui';
import {
  formatDateTime,
  formatIncidentType,
  formatPassStatus,
  formatPassType,
  formatRequestStatus,
  formatRequestType,
  formatSeverity,
  formatWindow,
  passStatusTone,
  requestStatusTone,
  severityTone,
} from '../components/formatters';

export function GuardConsolePage() {
  const session = useV1Session();
  const navigate = useNavigate();
  const canGuard = isGuardRole(session.role);
  const canOnboard = ['property_admin', 'management_company_admin', 'platform_admin']
    .includes(normalizeUserRole(session.role));
  const propertyId = session.property_id ?? null;
  const labels = useMemo(() => getPropertyLabels(session.property_type), [session.property_type]);
  const pinCredentialsEnabled = session.feature_flags?.pin_credentials === true;
  const guardAuthorizedDevicesEnabled = session.feature_flags?.guard_authorized_devices === true;
  const [selectedAccessPointId, setSelectedAccessPointId] = useState<UUID | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [guardDevice, setGuardDevice] = useState<GuardAuthorizedDeviceContext | null>(null);

  const refreshWorkspace = useCallback(() => {
    setRefreshToken((t) => t + 1);
  }, []);

  if (!canGuard) {
    return (
      <div className={uiClasses.pageShell}>
        <Alert tone="error">
          Эта страница доступна только сотрудникам охраны и администраторам.
        </Alert>
      </div>
    );
  }
  if (!propertyId) {
    return (
      <div className={uiClasses.pageShell}>
        <Alert tone="error">
          Не удалось определить объект охраны. Проверьте привязку пользователя к
          property и войдите снова.
        </Alert>
      </div>
    );
  }

  return (
    <div className={uiClasses.pageShell}>
      <header className={uiClasses.pageHeader}>
        <Inline>
          <h1 className={uiClasses.pageTitle}>{labels.guardTitle}</h1>
          <Button variant="ghost" onClick={() => navigate('/v1/staff-workspace')}>
            Рабочее место staff
          </Button>
          {canOnboard ? (
            <>
              <Button variant="ghost" onClick={() => navigate('/v1/admin/access')}>
                Настройки доступа
              </Button>
              <Button variant="ghost" onClick={() => navigate('/v1/onboarding')}>
                Онбординг
              </Button>
            </>
          ) : null}
        </Inline>
        <p className={uiClasses.pageSubtitle}>
          {labels.guardSubtitle}{session.property_slug ? ` · ${session.property_slug}` : ''}
        </p>
      </header>

      <div className={uiClasses.twoColumn}>
        <Stack>
          {guardAuthorizedDevicesEnabled ? (
            <GuardDeviceEnrollmentPanel
              propertyId={propertyId}
              accessPointId={selectedAccessPointId}
              onDeviceReady={setGuardDevice}
            />
          ) : null}
          <ScanPanel
            propertyId={propertyId}
            accessPointId={selectedAccessPointId}
            pinEnabled={pinCredentialsEnabled}
            guardDevice={guardDevice}
            onAccessPointChange={setSelectedAccessPointId}
            onVerified={refreshWorkspace}
          />
        </Stack>

        <SecurityWorkspacePane
          propertyId={propertyId}
          propertyType={session.property_type ?? null}
          accessPointId={selectedAccessPointId}
          refreshToken={refreshToken}
          onRefresh={refreshWorkspace}
        />
      </div>
    </div>
  );
}

interface StoredGuardDevice extends GuardAuthorizedDeviceContext {
  label?: string;
  status?: 'pending' | 'active';
}

function guardDeviceStorageKey(propertyId: UUID, accessPointId: UUID | null): string {
  return `rz:v1:guard-device:${propertyId}:${accessPointId || 'property'}`;
}

function generateDeviceFingerprint(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return `guard-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 18)}`;
}

function readStoredGuardDevice(propertyId: UUID, accessPointId: UUID | null): StoredGuardDevice | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(guardDeviceStorageKey(propertyId, accessPointId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredGuardDevice>;
    if (!parsed.guard_device_id || !parsed.device_fingerprint) return null;
    return {
      guard_device_id: parsed.guard_device_id,
      device_fingerprint: parsed.device_fingerprint,
      label: parsed.label,
      status: parsed.status === 'pending' ? 'pending' : 'active',
    };
  } catch {
    return null;
  }
}

function writeStoredGuardDevice(propertyId: UUID, accessPointId: UUID | null, device: StoredGuardDevice) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(guardDeviceStorageKey(propertyId, accessPointId), JSON.stringify(device));
  } catch {
    throw new Error('Браузер заблокировал локальное хранение устройства охраны');
  }
}

function GuardDeviceEnrollmentPanel({
  propertyId,
  accessPointId,
  onDeviceReady,
}: {
  propertyId: UUID;
  accessPointId: UUID | null;
  onDeviceReady: (device: GuardAuthorizedDeviceContext | null) => void;
}) {
  const [stored, setStored] = useState<StoredGuardDevice | null>(null);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const next = readStoredGuardDevice(propertyId, accessPointId);
    setStored(next);
    onDeviceReady(next && next.status !== 'pending' ? next : null);
    setLabel(next?.label || '');
    setError(null);
  }, [accessPointId, onDeviceReady, propertyId]);

  async function enroll() {
    const deviceFingerprint = stored?.device_fingerprint || generateDeviceFingerprint();
    const resolvedLabel = label.trim()
      || (accessPointId ? `Пост охраны ${accessPointId.slice(0, 8)}` : 'Пост охраны');
    setSaving(true);
    setError(null);
    try {
      const res = await api.securityWorkspace.enrollAuthorizedDevice({
        property_id: propertyId,
        access_point_id: accessPointId,
        device_fingerprint: deviceFingerprint,
        label: resolvedLabel,
      });
      const next: StoredGuardDevice = {
        guard_device_id: res.guard_authorized_device.id,
        device_fingerprint: deviceFingerprint,
        label: res.guard_authorized_device.label,
        status: res.guard_authorized_device.status === 'active' ? 'active' : 'pending',
      };
      writeStoredGuardDevice(propertyId, accessPointId, next);
      setStored(next);
      setLabel(next.label || '');
      onDeviceReady(next.status === 'active' ? next : null);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось авторизовать устройство охраны');
      onDeviceReady(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title="Устройство поста"
      subtitle={accessPointId ? `Привязка к КПП ${accessPointId.slice(0, 8)}` : 'Выберите КПП для точной привязки'}
      actions={
        stored
          ? <Badge tone={stored.status === 'pending' ? 'warning' : 'success'}>{stored.status === 'pending' ? 'На подтверждении' : 'Авторизовано'}</Badge>
          : <Badge tone="warning">Требуется enrollment</Badge>
      }
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      {stored ? (
        <Stack>
          <p className={uiClasses.textMuted}>
            {stored.label || 'Пост охраны'} · ID {stored.guard_device_id.slice(0, 8)}
          </p>
          {stored.status === 'pending' ? (
            <Alert tone="warning">
              Устройство ожидает подтверждения администратором. Ручные решения будут заблокированы до подтверждения.
            </Alert>
          ) : null}
          <Inline>
            <Button type="button" variant="secondary" loading={saving} onClick={() => void enroll()}>
              {stored.status === 'pending' ? 'Проверить статус' : 'Обновить привязку'}
            </Button>
          </Inline>
        </Stack>
      ) : (
        <Stack>
          <Field label="Метка устройства">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Например, КПП Север планшет"
              disabled={saving}
            />
          </Field>
          <Button type="button" loading={saving} onClick={() => void enroll()}>
            Запросить подтверждение
          </Button>
        </Stack>
      )}
    </Card>
  );
}

interface SecurityWorkspacePaneProps {
  propertyId: UUID;
  propertyType: PropertyType | null;
  accessPointId: UUID | null;
  refreshToken: number;
  onRefresh: () => void;
}

function SecurityWorkspacePane({
  propertyId,
  propertyType,
  accessPointId,
  refreshToken,
  onRefresh,
}: SecurityWorkspacePaneProps) {
  const [workspace, setWorkspace] = useState<SecurityWorkspaceBootstrap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.securityWorkspace.bootstrap({
        property_id: propertyId,
        access_point_id: accessPointId,
        active_passes_limit: 12,
        expected_guests_limit: 12,
        recent_events_limit: 12,
        blacklist_hits_limit: 8,
      });
      setWorkspace(res.workspace);
    } catch (err) {
      setWorkspace(null);
      setError(isV1ApiError(err) ? err.message : 'Не удалось загрузить рабочее место охраны');
    } finally {
      setLoading(false);
    }
  }, [accessPointId, propertyId]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const station = workspace?.station_context;
  const stationSubtitle = station?.access_point
    ? `${station.access_point.name}${station.access_zone ? ` · ${station.access_zone.name}` : ''}`
    : 'Без фильтра по КПП';

  return (
    <Stack>
      <Card
        title="Контекст КПП"
        subtitle={stationSubtitle}
        actions={
          <Button variant="ghost" loading={loading} onClick={onRefresh}>
            Обновить
          </Button>
        }
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        {!workspace && loading ? (
          <Inline>
            <Spinner />
            <span className={uiClasses.textMuted}>Загрузка контекста…</span>
          </Inline>
        ) : workspace ? (
          <Inline>
            <Badge tone="info">Ожидаются: {workspace.expected_guests.length}</Badge>
            <Badge tone="success">Активные: {workspace.active_passes.length}</Badge>
            <Badge tone={workspace.blacklist_hits.length > 0 ? 'error' : 'neutral'}>
              Риски: {workspace.blacklist_hits.length}
            </Badge>
            <span className={uiClasses.textDim}>Обновлено {formatDateTime(workspace.generated_at)}</span>
          </Inline>
        ) : null}
      </Card>

      <WorkspaceSearch propertyId={propertyId} propertyType={propertyType} accessPointId={accessPointId} />

      {workspace ? (
        <>
          <ExpectedGuestsPanel guests={workspace.expected_guests} propertyType={propertyType} />
          <RecentEventsPanel events={workspace.recent_events} />
          <BlacklistHitsPanel hits={workspace.blacklist_hits} />
          <ActivePassesPanel passes={workspace.active_passes} propertyType={propertyType} onRefresh={onRefresh} />
        </>
      ) : null}
    </Stack>
  );
}

function ExpectedGuestsPanel({
  guests,
  propertyType,
}: {
  guests: SecurityWorkspaceExpectedGuest[];
  propertyType: PropertyType | null;
}) {
  return (
    <Card title="Ожидаемые гости">
      {guests.length === 0 ? (
        <EmptyState>На ближайшие 24 часа ожидаемых визитов нет.</EmptyState>
      ) : (
        <ul className={uiClasses.resourceList}>
          {guests.map((guest) => (
            <li key={guest.id} className={uiClasses.resourceRow}>
              <div className={uiClasses.resourceRowMain}>
                <p className={uiClasses.resourceTitle}>
                  {guest.visitor_name || formatRequestType(guest.request_type)}
                </p>
                <div className={uiClasses.resourceMeta}>
                  <span>{formatRequestType(guest.request_type)}</span>
                  <span>{formatWindow(guest.starts_at, guest.ends_at)}</span>
                  {guest.unit_number ? (
                    <span>{formatUnitLabel({ unit_number: guest.unit_number, unit_type: guest.unit_type }, propertyType)}</span>
                  ) : null}
                  {guest.plate_number ? <span>{guest.plate_number}</span> : null}
                  {guest.visitor_phone ? <span>{guest.visitor_phone}</span> : null}
                </div>
                {guest.reason ? <p className={uiClasses.textMuted}>{guest.reason}</p> : null}
                {guest.guest_instructions ? (
                  <p className={uiClasses.textMuted}>Для гостя: {guest.guest_instructions}</p>
                ) : null}
                {guest.guard_notes ? (
                  <p className={uiClasses.textBody}>Охране: {guest.guard_notes}</p>
                ) : null}
              </div>
              <Badge tone={requestStatusTone(guest.status)}>{formatRequestStatus(guest.status)}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ActivePassesPanel({
  passes,
  propertyType,
  onRefresh,
}: {
  passes: SecurityWorkspaceActivePass[];
  propertyType: PropertyType | null;
  onRefresh: () => void;
}) {
  return (
    <Card title="Активные пропуски">
      {passes.length === 0 ? (
        <EmptyState>Активных пропусков для выбранного КПП нет.</EmptyState>
      ) : (
        <ul className={uiClasses.resourceList}>
          {passes.map((pass) => (
            <ActivePassRow key={pass.id} pass={pass} propertyType={propertyType} onRefresh={onRefresh} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ActivePassRow({
  pass,
  propertyType,
  onRefresh,
}: {
  pass: SecurityWorkspaceActivePass;
  propertyType: PropertyType | null;
  onRefresh: () => void;
}) {
  const [showRevoke, setShowRevoke] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canRevoke = pass.status === 'active' || pass.status === 'blocked';

  async function submitRevoke() {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError('Укажите причину отзыва');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.passes.revoke(pass.id, trimmed);
      setShowRevoke(false);
      setReason('');
      onRefresh();
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось отозвать пропуск');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <li className={uiClasses.resourceRow}>
      <div className={uiClasses.resourceRowMain}>
        <p className={uiClasses.resourceTitle}>
          {pass.resident_name || pass.plate_number || formatPassType(pass.pass_type)}
        </p>
        <div className={uiClasses.resourceMeta}>
          <span>{formatPassType(pass.pass_type)}</span>
          <span>{formatWindow(pass.valid_from, pass.valid_until)}</span>
          {pass.unit_number ? (
            <span>{formatUnitLabel({ unit_number: pass.unit_number, unit_type: pass.unit_type }, propertyType)}</span>
          ) : null}
          {pass.plate_number ? <span>{pass.plate_number}</span> : null}
        </div>
        {pass.guest_instructions ? (
          <p className={uiClasses.textMuted}>Для гостя: {pass.guest_instructions}</p>
        ) : null}
        {pass.guard_notes ? (
          <p className={uiClasses.textBody}>Охране: {pass.guard_notes}</p>
        ) : null}
        {showRevoke ? (
          <Stack className={uiClasses.marginTop3}>
            <Field label="Причина отзыва" error={error ?? undefined}>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Например, гость отменил визит"
                disabled={submitting}
              />
            </Field>
            <Inline>
              <Button variant="danger" loading={submitting} onClick={submitRevoke}>
                Подтвердить отзыв
              </Button>
              <Button variant="ghost" disabled={submitting} onClick={() => setShowRevoke(false)}>
                Отмена
              </Button>
            </Inline>
          </Stack>
        ) : null}
      </div>
      <Inline>
        <Badge tone={passStatusTone(pass.status)}>{formatPassStatus(pass.status)}</Badge>
        {canRevoke && !showRevoke ? (
          <Button variant="danger" onClick={() => setShowRevoke(true)}>
            Отозвать
          </Button>
        ) : null}
      </Inline>
    </li>
  );
}

function RecentEventsPanel({ events }: { events: SecurityWorkspaceRecentEvent[] }) {
  return (
    <Card title="Последние события">
      {events.length === 0 ? (
        <EmptyState>Событий прохода пока нет.</EmptyState>
      ) : (
        <ul className={uiClasses.timeline}>
          {events.map((event) => (
            <li key={event.id} className={uiClasses.timelineItem}>
              <time className={uiClasses.timelineTime}>{formatDateTime(event.occurred_at)}</time>
              <div className={uiClasses.timelineBody}>
                <Inline>
                  <Badge tone={event.event_type.includes('denied') || event.event_type === 'manual_deny' ? 'error' : 'success'}>
                    {formatVisitEvent(event.event_type)}
                  </Badge>
                  {event.incident_type ? (
                    <Badge tone={event.severity ? severityTone(event.severity) : 'warning'}>
                      {formatIncidentType(event.incident_type)}
                    </Badge>
                  ) : null}
                </Inline>
                <p className={uiClasses.textBody}>
                  {event.person_label || event.vehicle_plate || event.pass_id || 'Событие доступа'}
                </p>
                <p className={uiClasses.textDim}>
                  {[event.access_point_name, event.access_zone_name].filter(Boolean).join(' · ') || 'КПП не указано'}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function BlacklistHitsPanel({ hits }: { hits: SecurityWorkspaceBlacklistHit[] }) {
  return (
    <Card title="Риски и blacklist">
      {hits.length === 0 ? (
        <EmptyState>Открытых blacklist/policy инцидентов нет.</EmptyState>
      ) : (
        <ul className={uiClasses.resourceList}>
          {hits.map((hit) => (
            <li key={hit.id} className={uiClasses.resourceRow}>
              <div className={uiClasses.resourceRowMain}>
                <p className={uiClasses.resourceTitle}>{hit.title || formatIncidentType(hit.incident_type)}</p>
                <div className={uiClasses.resourceMeta}>
                  <span>{formatIncidentType(hit.incident_type)}</span>
                  <span>{formatDateTime(hit.created_at)}</span>
                  {hit.plate_number ? <span>{hit.plate_number}</span> : null}
                </div>
              </div>
              <Badge tone={severityTone(hit.severity)}>{formatSeverity(hit.severity)}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function WorkspaceSearch({
  propertyId,
  propertyType,
  accessPointId,
}: {
  propertyId: UUID;
  propertyType: PropertyType | null;
  accessPointId: UUID | null;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SecurityWorkspaceSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) {
      setError('Введите минимум 2 символа');
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const res = await api.securityWorkspace.search({
        property_id: propertyId,
        access_point_id: accessPointId,
        q,
        limit: 8,
      });
      setResults(res.results);
    } catch (err) {
      setResults(null);
      setError(isV1ApiError(err) ? err.message : 'Не удалось выполнить поиск');
    } finally {
      setSearching(false);
    }
  }, [accessPointId, propertyId, query]);

  return (
    <Card title="Поиск по КПП" subtitle="Авто, житель, квартира или пропуск">
      <form onSubmit={submit}>
        <Field id="security-workspace-search" error={error ?? undefined}>
          <Input
            id="security-workspace-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Номер, ФИО, квартира или pass id"
            autoComplete="off"
            disabled={searching}
          />
        </Field>
        <Inline>
          <Button type="submit" loading={searching}>Найти</Button>
          {results || query ? (
            <Button
              type="button"
              variant="ghost"
              disabled={searching}
              onClick={() => {
                setQuery('');
                setResults(null);
                setError(null);
              }}
            >
              Сбросить
            </Button>
          ) : null}
        </Inline>
      </form>

      {results ? (
        <SearchResults results={results} propertyType={propertyType} />
      ) : null}
    </Card>
  );
}

function SearchResults({
  results,
  propertyType,
}: {
  results: SecurityWorkspaceSearchResult;
  propertyType: PropertyType | null;
}) {
  const total = results.vehicles.length + results.residents.length + results.units.length + results.passes.length;
  if (total === 0) {
    return <EmptyState className={uiClasses.marginTop3}>Ничего не найдено.</EmptyState>;
  }
  return (
    <Stack className={uiClasses.marginTop3}>
      <VehicleSearchRows vehicles={results.vehicles} />
      <ResidentSearchRows residents={results.residents} propertyType={propertyType} />
      <UnitSearchRows units={results.units} propertyType={propertyType} />
      <PassSearchRows passes={results.passes} propertyType={propertyType} />
    </Stack>
  );
}

function VehicleSearchRows({ vehicles }: { vehicles: SecurityWorkspaceVehicleSearchRow[] }) {
  const [rows, setRows] = useState(vehicles);

  useEffect(() => {
    setRows(vehicles);
  }, [vehicles]);

  if (rows.length === 0) return null;
  return (
    <SearchSection title="Авто">
      {rows.map((vehicle) => (
        <li key={vehicle.id} className={uiClasses.resourceRow}>
          <div className={uiClasses.resourceRowMain}>
            <p className={uiClasses.resourceTitle}>{vehicle.plate_number}</p>
            <div className={uiClasses.resourceMeta}>
              {vehicle.brand ? <span>{vehicle.brand}</span> : null}
              {vehicle.model ? <span>{vehicle.model}</span> : null}
              {vehicle.color ? <span>{vehicle.color}</span> : null}
            </div>
          </div>
          <Badge tone={vehicle.is_blacklisted ? 'error' : vehicle.is_whitelisted ? 'success' : 'neutral'}>
            {vehicle.is_blacklisted ? 'Blacklist' : vehicle.is_whitelisted ? 'Whitelist' : 'Без статуса'}
          </Badge>
          <VehicleFlagActions
            vehicle={vehicle}
            onChanged={(next) => {
              setRows((current) => current.map((row) => (row.id === next.id ? next : row)));
            }}
          />
        </li>
      ))}
    </SearchSection>
  );
}

function VehicleFlagActions({
  vehicle,
  onChanged,
}: {
  vehicle: SecurityWorkspaceVehicleSearchRow;
  onChanged: (vehicle: SecurityWorkspaceVehicleSearchRow) => void;
}) {
  const [action, setAction] = useState<'blacklist' | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: 'whitelist' | 'blacklist' | 'clear') {
    const trimmed = reason.trim();
    if (kind === 'blacklist' && !trimmed) {
      setError('Причина обязательна');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = kind === 'whitelist'
        ? await api.vehicles.whitelist(vehicle.id)
        : kind === 'blacklist'
          ? await api.vehicles.blacklist(vehicle.id, trimmed)
          : await api.vehicles.clearFlags(vehicle.id);
      onChanged(res.vehicle);
      setAction(null);
      setReason('');
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось обновить авто');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Stack>
      {action === null ? (
        <Inline>
          {!vehicle.is_whitelisted ? (
            <Button variant="secondary" loading={submitting} onClick={() => run('whitelist')}>
              В белый список
            </Button>
          ) : null}
          {!vehicle.is_blacklisted ? (
            <Button variant="danger" disabled={submitting} onClick={() => setAction('blacklist')}>
              В чёрный список
            </Button>
          ) : null}
          {vehicle.is_whitelisted || vehicle.is_blacklisted ? (
            <Button variant="ghost" loading={submitting} onClick={() => run('clear')}>
              Сбросить флаги
            </Button>
          ) : null}
        </Inline>
      ) : (
        <Stack>
          <Field label="Причина занесения в ЧС" error={error ?? undefined}>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Например, повторные нарушения"
              disabled={submitting}
            />
          </Field>
          <Inline>
            <Button variant="danger" loading={submitting} onClick={() => run('blacklist')}>
              Подтвердить
            </Button>
            <Button variant="ghost" disabled={submitting} onClick={() => setAction(null)}>
              Отмена
            </Button>
          </Inline>
        </Stack>
      )}
    </Stack>
  );
}

function ResidentSearchRows({
  residents,
  propertyType,
}: {
  residents: SecurityWorkspaceResidentSearchRow[];
  propertyType: PropertyType | null;
}) {
  if (residents.length === 0) return null;
  return (
    <SearchSection title="Жители">
      {residents.map((resident) => (
        <li key={resident.id} className={uiClasses.resourceRow}>
          <div className={uiClasses.resourceRowMain}>
            <p className={uiClasses.resourceTitle}>{resident.full_name}</p>
            <div className={uiClasses.resourceMeta}>
              <span>{formatUnitLabel({ unit_number: resident.unit_number, unit_type: resident.unit_type }, propertyType)}</span>
              {resident.phone ? <span>{resident.phone}</span> : null}
              {resident.email ? <span>{resident.email}</span> : null}
            </div>
          </div>
          <Badge tone="info">{resident.resident_type || resident.role || 'resident'}</Badge>
        </li>
      ))}
    </SearchSection>
  );
}

function UnitSearchRows({
  units,
  propertyType,
}: {
  units: SecurityWorkspaceUnitSearchRow[];
  propertyType: PropertyType | null;
}) {
  if (units.length === 0) return null;
  return (
    <SearchSection title="Адреса">
      {units.map((unit) => (
        <li key={unit.id} className={uiClasses.resourceRow}>
          <div className={uiClasses.resourceRowMain}>
            <p className={uiClasses.resourceTitle}>
              {formatUnitLabel({ unit_number: unit.unit_number, unit_type: unit.unit_type }, propertyType)}
            </p>
            <div className={uiClasses.resourceMeta}>
              {unit.floor !== null ? <span>Этаж {unit.floor}</span> : null}
              <span>{unit.is_active ? 'active' : 'inactive'}</span>
            </div>
          </div>
        </li>
      ))}
    </SearchSection>
  );
}

function PassSearchRows({
  passes,
  propertyType,
}: {
  passes: SecurityWorkspacePassSearchRow[];
  propertyType: PropertyType | null;
}) {
  if (passes.length === 0) return null;
  return (
    <SearchSection title="Пропуски">
      {passes.map((pass) => (
        <li key={pass.id} className={uiClasses.resourceRow}>
          <div className={uiClasses.resourceRowMain}>
            <p className={uiClasses.resourceTitle}>
              {pass.resident_name || pass.plate_number || pass.id.slice(0, 8)}
            </p>
            <div className={uiClasses.resourceMeta}>
              <span>{formatPassType(pass.pass_type)}</span>
              <span>{formatWindow(pass.valid_from, pass.valid_until)}</span>
              {pass.unit_number ? (
                <span>{formatUnitLabel({ unit_number: pass.unit_number }, propertyType)}</span>
              ) : null}
              {pass.plate_number ? <span>{pass.plate_number}</span> : null}
            </div>
          </div>
          <Badge tone={passStatusTone(pass.status)}>{formatPassStatus(pass.status)}</Badge>
        </li>
      ))}
    </SearchSection>
  );
}

function SearchSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h4 className={uiClasses.sectionHeading}>{title}</h4>
      <ul className={uiClasses.resourceList}>{children}</ul>
    </section>
  );
}

function formatVisitEvent(eventType: SecurityWorkspaceRecentEvent['event_type']): string {
  const labels: Record<SecurityWorkspaceRecentEvent['event_type'], string> = {
    entry_allowed: 'Въезд разрешён',
    entry_denied: 'Въезд запрещён',
    exit_allowed: 'Выезд разрешён',
    exit_denied: 'Выезд запрещён',
    manual_admit: 'Ручной допуск',
    manual_deny: 'Ручной отказ',
    override: 'Override',
  };
  return labels[eventType] ?? eventType;
}
