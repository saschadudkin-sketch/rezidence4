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
 * Known backend gaps — handled explicitly rather than silently:
 *   - Residents cannot list /units or /vehicles:
 *       · units — we synthesise a single-item list from resident.unit_id
 *         labelled with session.apartment (which is also what the user sees
 *         in the top bar of the legacy UI).
 *       · vehicles — empty array; we also hide `vehicle_access` from the
 *         request-type picker since there is no inline-create-vehicle flow
 *         yet.  Residents who need to register a new car still go through
 *         the concierge.
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
import type { AccessRequest, PropertyType, QrToken, RequestType, UUID } from '../api/types';
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
  EmptyState,
  Inline,
  Spinner,
  Stack,
  Toolbar,
  uiClasses,
} from '../components/ui';

/**
 * Request types the resident can pick from their landing page.
 * `vehicle_access` is intentionally excluded — see file header.
 */
const RESIDENT_REQUEST_TYPES: ReadonlyArray<RequestType> = [
  'guest_access',
  'courier_access',
  'service_access',
];

interface LoadedState {
  resident: ResidentWithUnit;
  requests: AccessRequest[];
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
      const listRes = await api.accessRequests.list({
        created_by_resident_id: resident.id,
        limit: 20,
      });
      setState({
        kind: 'ready',
        data: { resident, requests: listRes.access_requests },
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
    setFormOpen(false);
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
          apartmentLabel={session.apartment ?? null}
          propertyType={session.property_type ?? null}
          formOpen={formOpen}
          onOpenForm={() => setFormOpen(true)}
          onCancelForm={() => setFormOpen(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}

interface ReadyProps {
  resident: ResidentWithUnit;
  requests: readonly AccessRequest[];
  apartmentLabel: string | null;
  propertyType: PropertyType | null;
  formOpen: boolean;
  onOpenForm: () => void;
  onCancelForm: () => void;
  onCreated: (request: AccessRequest) => void;
}

function ResidentAccessReady({
  resident,
  requests,
  apartmentLabel,
  propertyType,
  formOpen,
  onOpenForm,
  onCancelForm,
  onCreated,
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

      {formOpen && canCreate && resident.property_id ? (
        <AccessRequestForm
          propertyId={resident.property_id}
          propertyType={propertyType}
          units={units}
          vehicles={[]}
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
            <AccessRequestCard key={r.id} request={r}>
              <ResidentQrPanel request={r} />
            </AccessRequestCard>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

type QrState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; qr: QrToken; dataUrl: string | null }
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
      try {
        const QRCode = (await import('qrcode')).default;
        dataUrl = await QRCode.toDataURL(qr.token, {
          margin: 1,
          width: 168,
          color: { dark: '#13110E', light: '#FFFFFF' },
        });
      } catch {
        dataUrl = null;
      }
      setState({ kind: 'ready', qr, dataUrl });
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
              {state.qr.token}
            </span>
            <Inline>
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

