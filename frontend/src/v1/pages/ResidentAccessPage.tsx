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
import type { AccessRequest, RequestType, UUID } from '../api/types';
import { api, isV1ApiError } from '../api';
import type { ResidentWithUnit } from '../api/residents';
import { useV1Session } from '../store';
import { AccessRequestForm } from '../components/AccessRequestForm';
import type { UnitOption } from '../components/AccessRequestForm';
import { AccessRequestCard } from '../components/AccessRequestCard';
import { ResidentNav } from '../components/ResidentNav';
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
            ? `Квартира ${session.apartment}`
            : 'Квартира не привязана — обратитесь в управляющую.'}
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
  formOpen: boolean;
  onOpenForm: () => void;
  onCancelForm: () => void;
  onCreated: (request: AccessRequest) => void;
}

function ResidentAccessReady({
  resident,
  requests,
  apartmentLabel,
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
      },
    ];
  }, [resident.unit_id, apartmentLabel]);

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
          К вашей учётной записи не привязана квартира. Попросите консьержа обновить
          профиль — без этого заявка на гостя не пройдёт.
        </Alert>
      ) : null}

      {formOpen && canCreate && resident.property_id ? (
        <AccessRequestForm
          propertyId={resident.property_id}
          units={units}
          vehicles={[]}
          allowedRequestTypes={RESIDENT_REQUEST_TYPES}
          onCreated={onCreated}
          onCancel={onCancelForm}
        />
      ) : null}

      {requests.length === 0 ? (
        <EmptyState>
          Заявок пока нет. Создайте первую — консьерж согласует за пару минут.
        </EmptyState>
      ) : (
        <Stack>
          {requests.map((r) => (
            <AccessRequestCard key={r.id} request={r} />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

