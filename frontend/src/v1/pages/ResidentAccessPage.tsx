/**
 * ResidentAccessPage — landing page for owner/tenant/contractor roles.
 *
 * What it does:
 *   - Resolves the resident row for the current JWT user (GET /residents/:uid).
 *     The backend's residents route permits self-or-staff reads, so a
 *     resident can read their own row by passing their JWT `uid`.
 *   - Lists the user's own access-requests (newest first) via
 *     `GET /access-requests?created_by_resident_id=<resident.id>`.
 *   - Opens <AccessRequestForm> inline on "Create" click and refreshes the
 *     list after a successful create.
 *
 * Known backend gap — handled explicitly rather than silently:
 *   - Residents cannot list /units:
 *       · units — we synthesise a single-item list from resident.unit_id
 *         labelled with session.apartment (which is also what the user sees
 *         in the top bar of the legacy UI).
 *   - If the resident row has no unit_id, the form can't be submitted (the
 *     backend would 400 on missing target_unit_id); we show a guidance
 *     alert instead of rendering the form.
 *
 * Why plain useEffect, not React Query:
 *   - The root <App> wraps in QueryClientProvider, so we could use hooks,
 *     but this page is the first v1 page and I prefer to keep its data-flow
 *     transparent until we land the shared v1 query-client configuration.
 *     The list refetch after create is a single setCounter bump — no
 *     invalidation plumbing needed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AccessRequest,
  AccessPoint,
  AccessZone,
  PropertyType,
  QrToken,
  RequestType,
  TrustedVisitor,
  TrustedVisitorType,
  UUID,
  Vehicle,
  VehicleKind,
} from '../api/types';
import { api, isV1ApiError } from '../api';
import type { ResidentWithUnit } from '../api/residents';
import { useV1Session } from '../store';
import { AccessRequestForm } from '../components/AccessRequestForm';
import type { UnitOption } from '../components/AccessRequestForm';
import { AccessRequestCard } from '../components/AccessRequestCard';
import { ResidentNav } from '../components/ResidentNav';
import { formatUnitLabel, getPropertyLabels } from '../lib/propertyLabels';
import {
  Alert,
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
  Toolbar,
  uiClasses,
} from '../components/ui';

/**
 * Request types the resident can pick from their landing page.
 * Labels stay product-facing; backend request_type values stay internal.
 */
const RESIDENT_REQUEST_TYPES: ReadonlyArray<RequestType> = [
  'guest_access',
  'courier_access',
  'service_access',
  'vehicle_access',
];

interface LoadedState {
  resident: ResidentWithUnit;
  requests: AccessRequest[];
  vehicles: Vehicle[];
  trustedVisitors: TrustedVisitor[];
  zones: AccessZone[];
  points: AccessPoint[];
}

type PageState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: LoadedState };

export function ResidentAccessPage() {
  const session = useV1Session();
  const labels = useMemo(() => getPropertyLabels(session.property_type), [session.property_type]);
  const [state, setState] = useState<PageState>({ kind: 'loading' });
  const [refreshToken, setRefreshToken] = useState(0);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const residentRes = await api.residents.getById(session.uid);
      const resident = residentRes.resident;
      const [listRes, vehiclesRes, trustedVisitorsRes, zonesRes, pointsRes] = await Promise.all([
        api.accessRequests.list({
          created_by_resident_id: resident.id,
          limit: 20,
        }),
        resident.property_id
          ? api.vehicles.list({
            property_id: resident.property_id,
            owner_resident_id: resident.id,
            limit: 50,
          })
          : Promise.resolve({ vehicles: [] }),
        resident.property_id
          ? api.trustedVisitors.list({
            property_id: resident.property_id,
          }).catch(() => ({ trusted_visitors: [] }))
          : Promise.resolve({ trusted_visitors: [] }),
        resident.property_id
          ? api.accessTopology.listZones({ property_id: resident.property_id, is_active: true, limit: 100 })
            .catch(() => ({ zones: [] }))
          : Promise.resolve({ zones: [] }),
        resident.property_id
          ? api.accessTopology.listPoints({ property_id: resident.property_id, is_active: true, limit: 100 })
            .catch(() => ({ points: [] }))
          : Promise.resolve({ points: [] }),
      ]);
      setState({
        kind: 'ready',
        data: {
          resident,
          requests: listRes.access_requests,
          vehicles: vehiclesRes.vehicles,
          trustedVisitors: trustedVisitorsRes.trusted_visitors,
          zones: zonesRes.zones,
          points: pointsRes.points,
        },
      });
    } catch (err) {
      const message = isV1ApiError(err)
        ? err.kind === 'unauthorized'
          ? 'Сессия истекла — войдите снова.'
          : err.kind === 'forbidden'
            ? 'Недостаточно прав для просмотра заявок этого резидента.'
            : err.message
        : 'Не удалось загрузить данные резидента.';
      setState({ kind: 'error', message });
    }
  }, [session.uid]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const handleCreated = useCallback((request: AccessRequest) => {
    // Optimistic prepend — the refetch below will reconcile with the server
    // ordering (created_at DESC), but the resident sees their new card
    // immediately.
    setState((prev) => {
      if (prev.kind !== 'ready') return prev;
      return {
        kind: 'ready',
        data: {
          ...prev.data,
          requests: [request, ...prev.data.requests],
        },
      };
    });
    setRefreshToken((t) => t + 1);
  }, []);

  const handleVehicleCreated = useCallback((vehicle: Vehicle) => {
    setState((prev) => {
      if (prev.kind !== 'ready') return prev;
      return {
        kind: 'ready',
        data: {
          ...prev.data,
          vehicles: [vehicle, ...prev.data.vehicles.filter((item) => item.id !== vehicle.id)],
        },
      };
    });
  }, []);

  const handleTrustedVisitorChanged = useCallback((visitor: TrustedVisitor) => {
    setState((prev) => {
      if (prev.kind !== 'ready') return prev;
      const withoutCurrent = prev.data.trustedVisitors.filter((item) => item.id !== visitor.id);
      return {
        kind: 'ready',
        data: {
          ...prev.data,
          trustedVisitors: visitor.is_active
            ? [visitor, ...withoutCurrent]
            : withoutCurrent,
        },
      };
    });
  }, []);

  const handleRequestUpdated = useCallback((request: AccessRequest) => {
    setState((prev) => {
      if (prev.kind !== 'ready') return prev;
      return {
        kind: 'ready',
        data: {
          ...prev.data,
          requests: prev.data.requests.map((item) => (item.id === request.id ? request : item)),
        },
      };
    });
  }, []);

  return (
    <div className={uiClasses.pageShell}>
      <header className={uiClasses.pageHeader}>
        <ResidentNav />
        <h1 className={uiClasses.pageTitle}>Мои заявки на доступ</h1>
        <p className={uiClasses.pageSubtitle}>
          {session.apartment
            ? formatUnitLabel({ unit_number: session.apartment }, session.property_type)
            : labels.unitMissing}
          {session.property_slug ? ` · ${session.property_slug}` : ''}
        </p>
      </header>

      {state.kind === 'loading' ? (
        <Inline>
          <Spinner />
          <span className={uiClasses.textMuted}>Загрузка заявок…</span>
        </Inline>
      ) : state.kind === 'error' ? (
        <Stack>
          <Alert tone="error">{state.message}</Alert>
          <Inline>
            <Button variant="secondary" onClick={() => setRefreshToken((t) => t + 1)}>
              Повторить
            </Button>
          </Inline>
        </Stack>
      ) : (
        <ResidentAccessReady
          resident={state.data.resident}
          requests={state.data.requests}
          vehicles={state.data.vehicles}
          trustedVisitors={state.data.trustedVisitors}
          zones={state.data.zones}
          points={state.data.points}
          apartmentLabel={session.apartment ?? null}
          propertyType={session.property_type ?? null}
          formOpen={formOpen}
          onOpenForm={() => setFormOpen(true)}
          onCancelForm={() => setFormOpen(false)}
          onCreated={handleCreated}
          onVehicleCreated={handleVehicleCreated}
          onTrustedVisitorChanged={handleTrustedVisitorChanged}
          onRequestUpdated={handleRequestUpdated}
        />
      )}
    </div>
  );
}

interface ReadyProps {
  resident: ResidentWithUnit;
  requests: readonly AccessRequest[];
  vehicles: readonly Vehicle[];
  trustedVisitors: readonly TrustedVisitor[];
  zones: readonly AccessZone[];
  points: readonly AccessPoint[];
  apartmentLabel: string | null;
  propertyType: PropertyType | null;
  formOpen: boolean;
  onOpenForm: () => void;
  onCancelForm: () => void;
  onCreated: (request: AccessRequest) => void;
  onVehicleCreated: (vehicle: Vehicle) => void;
  onTrustedVisitorChanged: (visitor: TrustedVisitor) => void;
  onRequestUpdated: (request: AccessRequest) => void;
}

function ResidentAccessReady({
  resident,
  requests,
  vehicles,
  trustedVisitors,
  zones,
  points,
  apartmentLabel,
  propertyType,
  formOpen,
  onOpenForm,
  onCancelForm,
  onCreated,
  onVehicleCreated,
  onTrustedVisitorChanged,
  onRequestUpdated,
}: ReadyProps) {
  // Must have a unit_id AND a property_id to submit a request — otherwise
  // the form 400s on the backend and the UX is worse.
  const canCreate = Boolean(resident.unit_id && resident.property_id);

  const units: UnitOption[] = useMemo(() => {
    if (!resident.unit_id) return [];
    return [
      {
        id: resident.unit_id as UUID,
        unit_number: apartmentLabel ?? '—',
        unit_type: propertyType === 'cottage_community' ? 'house' : 'apartment',
      },
    ];
  }, [resident.unit_id, apartmentLabel, propertyType]);

  const labels = useMemo(() => getPropertyLabels(propertyType), [propertyType]);

  return (
    <Stack>
      <Toolbar>
        <div className={uiClasses.inline}>
          <span className={uiClasses.textMuted}>
            Заявок: <strong>{requests.length}</strong>
          </span>
        </div>
        {!formOpen ? (
          <Button onClick={onOpenForm} disabled={!canCreate}>
            Создать заявку
          </Button>
        ) : null}
      </Toolbar>

      {!canCreate ? (
        <Alert tone="warning">
          К вашей учётной записи не привязан {labels.unitLower}. Попросите консьержа обновить
          профиль — без этого заявка на гостя не пройдёт.
        </Alert>
      ) : null}

      {canCreate && resident.property_id ? (
        <ResidentVehiclesPanel
          propertyId={resident.property_id}
          residentId={resident.id}
          vehicles={vehicles}
          onCreated={onVehicleCreated}
        />
      ) : null}

      {canCreate && resident.property_id ? (
        <TrustedVisitorsPanel
          propertyId={resident.property_id}
          unitId={resident.unit_id as UUID}
          visitors={trustedVisitors}
          onChanged={onTrustedVisitorChanged}
          onPassCreated={onCreated}
        />
      ) : null}

      {formOpen && canCreate && resident.property_id ? (
        <AccessRequestForm
          propertyId={resident.property_id}
          propertyType={propertyType}
          units={units}
          vehicles={vehicles}
          zones={zones}
          points={points}
          allowedRequestTypes={RESIDENT_REQUEST_TYPES}
          onCreated={onCreated}
          onCancel={onCancelForm}
        />
      ) : null}

      {requests.length === 0 ? (
        <EmptyState>
          Заявок пока нет. Создайте первую — QR появится сразу, если объект не требует ручного согласования.
        </EmptyState>
      ) : (
        <Stack>
          {requests.map((r) => (
            <AccessRequestCard
              key={r.id}
              request={r}
              actions={<ResidentRequestActions request={r} onUpdated={onRequestUpdated} />}
            >
              <ResidentQrPanel request={r} />
            </AccessRequestCard>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function ResidentVehiclesPanel({
  propertyId,
  residentId,
  vehicles,
  onCreated,
}: {
  propertyId: UUID;
  residentId: UUID;
  vehicles: readonly Vehicle[];
  onCreated: (vehicle: Vehicle) => void;
}) {
  const [open, setOpen] = useState(false);
  const [plate, setPlate] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleKind>('car');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [color, setColor] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const normalizedPlate = plate.trim();
    if (!normalizedPlate) {
      setError('Укажите госномер');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await api.vehicles.create({
        property_id: propertyId,
        owner_type: 'resident',
        owner_resident_id: residentId,
        plate_number: normalizedPlate,
        vehicle_type: vehicleType,
        brand: brand.trim() || null,
        model: model.trim() || null,
        color: color.trim() || null,
      });
      onCreated(res.vehicle);
      setPlate('');
      setBrand('');
      setModel('');
      setColor('');
      setVehicleType('car');
      setOpen(false);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось добавить авто');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card
      title="Мои авто"
      actions={
        <Button type="button" variant="secondary" onClick={() => setOpen((v) => !v)}>
          {open ? 'Скрыть' : 'Добавить авто'}
        </Button>
      }
    >
      <Stack>
        {vehicles.length === 0 ? (
          <EmptyState>Добавьте авто, чтобы оформить заявку на въезд.</EmptyState>
        ) : (
          <Stack>
            {vehicles.map((vehicle) => (
              <Inline key={vehicle.id}>
                <strong>{vehicle.plate_number}</strong>
                {vehicle.brand || vehicle.model ? (
                  <span className={uiClasses.textMuted}>
                    {[vehicle.brand, vehicle.model].filter(Boolean).join(' ')}
                  </span>
                ) : null}
                {vehicle.is_whitelisted ? <span className={uiClasses.textMuted}>Белый список</span> : null}
                {vehicle.is_blacklisted ? <span className={uiClasses.textMuted}>Чёрный список</span> : null}
              </Inline>
            ))}
          </Stack>
        )}

        {open ? (
          <form onSubmit={submit}>
            <Stack>
              {error ? <Alert tone="error">{error}</Alert> : null}
              <Field label="Госномер" id="v1-resident-vehicle-plate">
                <Input
                  id="v1-resident-vehicle-plate"
                  aria-label="Госномер"
                  value={plate}
                  onChange={(e) => setPlate(e.target.value)}
                  placeholder="A001AA77"
                  disabled={submitting}
                />
              </Field>
              <Field label="Тип" id="v1-resident-vehicle-type">
                <Select
                  id="v1-resident-vehicle-type"
                  value={vehicleType}
                  onChange={(e) => setVehicleType(e.target.value as VehicleKind)}
                  disabled={submitting}
                >
                  <option value="car">Легковой автомобиль</option>
                  <option value="motorcycle">Мотоцикл</option>
                  <option value="truck">Грузовой</option>
                  <option value="service_vehicle">Сервисный</option>
                </Select>
              </Field>
              <Inline>
                <Field label="Марка" id="v1-resident-vehicle-brand">
                  <Input
                    id="v1-resident-vehicle-brand"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    disabled={submitting}
                  />
                </Field>
                <Field label="Модель" id="v1-resident-vehicle-model">
                  <Input
                    id="v1-resident-vehicle-model"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    disabled={submitting}
                  />
                </Field>
                <Field label="Цвет" id="v1-resident-vehicle-color">
                  <Input
                    id="v1-resident-vehicle-color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    disabled={submitting}
                  />
                </Field>
              </Inline>
              <Inline>
                <Button type="submit" loading={submitting}>
                  Сохранить авто
                </Button>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
                  Отмена
                </Button>
              </Inline>
            </Stack>
          </form>
        ) : null}
      </Stack>
    </Card>
  );
}

const TRUSTED_VISITOR_TYPE_LABELS: Record<TrustedVisitorType, string> = {
  guest: 'Гость',
  relative: 'Родственник',
  cleaner: 'Клининг',
  courier: 'Курьер',
  service: 'Сервис',
  caregiver: 'Помощник',
  other: 'Другое',
};

function TrustedVisitorsPanel({
  propertyId,
  unitId,
  visitors,
  onChanged,
  onPassCreated,
}: {
  propertyId: UUID;
  unitId: UUID;
  visitors: readonly TrustedVisitor[];
  onChanged: (visitor: TrustedVisitor) => void;
  onPassCreated: (request: AccessRequest) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [visitorType, setVisitorType] = useState<TrustedVisitorType>('guest');
  const [defaultInstructions, setDefaultInstructions] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [busyVisitorId, setBusyVisitorId] = useState<UUID | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Укажите имя');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await api.trustedVisitors.create({
        property_id: propertyId,
        name: name.trim(),
        phone: phone.trim() || null,
        visitor_type: visitorType,
        default_instructions: defaultInstructions.trim() || null,
      });
      onChanged(res.trusted_visitor);
      setName('');
      setPhone('');
      setVisitorType('guest');
      setDefaultInstructions('');
      setOpen(false);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось сохранить частого гостя');
    } finally {
      setSubmitting(false);
    }
  }

  async function createPass(visitor: TrustedVisitor) {
    setBusyVisitorId(visitor.id);
    setError(null);
    try {
      const starts = new Date();
      const ends = new Date(starts.getTime() + 4 * 60 * 60 * 1000);
      const res = await api.trustedVisitors.createPass(visitor.id, {
        property_id: propertyId,
        target_unit_id: unitId,
        starts_at: starts.toISOString(),
        ends_at: ends.toISOString(),
        share_delivery_channels: ['link', 'qr'],
      });
      onChanged(res.trusted_visitor);
      onPassCreated(res.access_request);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось создать пропуск');
    } finally {
      setBusyVisitorId(null);
    }
  }

  async function deactivate(visitor: TrustedVisitor) {
    setBusyVisitorId(visitor.id);
    setError(null);
    try {
      const res = await api.trustedVisitors.deactivate(visitor.id, { property_id: propertyId });
      onChanged(res.trusted_visitor);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось отключить гостя');
    } finally {
      setBusyVisitorId(null);
    }
  }

  return (
    <Card
      title="Частые гости"
      subtitle="Сохранённые гости и сервисные исполнители для быстрого выпуска пропуска."
      actions={
        <Button type="button" variant="secondary" onClick={() => setOpen((v) => !v)}>
          {open ? 'Скрыть' : 'Добавить'}
        </Button>
      }
    >
      <Stack>
        {error ? <Alert tone="error">{error}</Alert> : null}

        {visitors.length === 0 ? (
          <EmptyState>Добавьте частого гостя, чтобы оформлять повторный пропуск без заполнения формы.</EmptyState>
        ) : (
          <Stack>
            {visitors.map((visitor) => (
              <Inline key={visitor.id}>
                <strong>{visitor.name}</strong>
                <span className={uiClasses.textMuted}>{TRUSTED_VISITOR_TYPE_LABELS[visitor.visitor_type]}</span>
                {visitor.phone ? <span className={uiClasses.textMuted}>{visitor.phone}</span> : null}
                {visitor.last_used_at ? (
                  <span className={uiClasses.textMuted}>
                    Последний пропуск: {new Date(visitor.last_used_at).toLocaleString()}
                  </span>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  loading={busyVisitorId === visitor.id}
                  onClick={() => void createPass(visitor)}
                >
                  Создать пропуск
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busyVisitorId === visitor.id}
                  onClick={() => void deactivate(visitor)}
                >
                  Отключить
                </Button>
              </Inline>
            ))}
          </Stack>
        )}

        {open ? (
          <form onSubmit={submit}>
            <Stack>
              <Inline>
                <Field label="Имя" id="v1-trusted-visitor-name">
                  <Input
                    id="v1-trusted-visitor-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={submitting}
                  />
                </Field>
                <Field label="Телефон" id="v1-trusted-visitor-phone">
                  <Input
                    id="v1-trusted-visitor-phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={submitting}
                  />
                </Field>
                <Field label="Тип" id="v1-trusted-visitor-type">
                  <Select
                    id="v1-trusted-visitor-type"
                    value={visitorType}
                    onChange={(e) => setVisitorType(e.target.value as TrustedVisitorType)}
                    disabled={submitting}
                  >
                    {Object.entries(TRUSTED_VISITOR_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </Select>
                </Field>
              </Inline>
              <Field label="Инструкция гостю" id="v1-trusted-visitor-instructions">
                <Textarea
                  id="v1-trusted-visitor-instructions"
                  rows={3}
                  value={defaultInstructions}
                  onChange={(e) => setDefaultInstructions(e.target.value)}
                  disabled={submitting}
                />
              </Field>
              <Inline>
                <Button type="submit" loading={submitting}>
                  Сохранить
                </Button>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
                  Отмена
                </Button>
              </Inline>
            </Stack>
          </form>
        ) : null}
      </Stack>
    </Card>
  );
}

function ResidentRequestActions({
  request,
  onUpdated,
}: {
  request: AccessRequest;
  onUpdated: (request: AccessRequest) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canCancel = ['new', 'pending_approval', 'escalated'].includes(request.status);

  async function cancel() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.accessRequests.cancel(request.id, { expectedCurrentStatus: request.status });
      onUpdated(res.access_request);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось отменить заявку');
    } finally {
      setLoading(false);
    }
  }

  if (!canCancel && !error) return null;
  return (
    <Inline>
      {error ? <span className={uiClasses.textMuted}>{error}</span> : null}
      {canCancel ? (
        <Button type="button" variant="ghost" loading={loading} onClick={cancel}>
          Отменить
        </Button>
      ) : null}
    </Inline>
  );
}

type QrState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; qr: QrToken; shareUrl: string; dataUrl: string | null }
  | { kind: 'error'; message: string };

function ResidentQrPanel({ request }: { request: AccessRequest }) {
  const [state, setState] = useState<QrState>({ kind: 'idle' });

  const openQr = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const detail = await api.accessRequests.getById(request.id);
      if (!detail.pass) {
        setState({ kind: 'error', message: 'Пропуск ещё не выпущен.' });
        return;
      }
      const { qr } = await api.passes.getQr(detail.pass.id);
      let dataUrl: string | null = null;
      const shareUrl = `${window.location.origin}/p/${qr.token}`;
      try {
        const QRCode = (await import('qrcode')).default;
        dataUrl = await QRCode.toDataURL(shareUrl, {
          margin: 1,
          width: 168,
          color: { dark: '#13110E', light: '#FFFFFF' },
        });
      } catch {
        dataUrl = null;
      }
      setState({ kind: 'ready', qr, shareUrl, dataUrl });
    } catch (err) {
      setState({
        kind: 'error',
        message: isV1ApiError(err) ? err.message : 'Не удалось открыть QR.',
      });
    }
  }, [request.id]);

  if (request.status !== 'approved') return null;

  return (
    <Stack>
      {state.kind === 'idle' ? (
        <Inline>
          <Button type="button" variant="secondary" onClick={openQr}>
            Открыть QR
          </Button>
        </Inline>
      ) : null}

      {state.kind === 'loading' ? (
        <Inline>
          <Spinner />
          <span className={uiClasses.textMuted}>Готовим QR…</span>
        </Inline>
      ) : null}

      {state.kind === 'error' ? (
        <Alert tone="error">{state.message}</Alert>
      ) : null}

      {state.kind === 'ready' ? (
        <Inline>
          {state.dataUrl ? (
            <img
              src={state.dataUrl}
              alt="QR пропуска"
              width={168}
              height={168}
            />
          ) : null}
          <Stack>
            <span className={uiClasses.textMuted}>QR-токен</span>
            <span className={uiClasses.textMono} data-testid="v1-qr-token">
              {state.shareUrl}
            </span>
            <Inline>
              <Button type="button" variant="secondary" onClick={() => window.open(state.shareUrl, '_blank', 'noopener,noreferrer')}>
                Открыть ссылку
              </Button>
              <Button type="button" variant="ghost" onClick={openQr}>
                Обновить
              </Button>
            </Inline>
          </Stack>
        </Inline>
      ) : null}
    </Stack>
  );
}

