/**
 * GuardConsolePage — duty station for security / admin roles.
 *
 * Layout is a two-column grid:
 *   ┌──────────────┬──────────────────────────┐
 *   │              │  Tabs: Пропуски | Авто    │
 *   │  ScanPanel   │  ───────────────────────  │
 *   │              │  Active passes / vehicle │
 *   │              │  lookup with inline       │
 *   │              │  revoke / black-list.     │
 *   └──────────────┴──────────────────────────┘
 *
 * Data flow:
 *   - Scan verdict (<ScanPanel>) fires onVerified → we bump a refresh token
 *     so the right-hand tabs refetch.  Verify may flip a pass to `used`,
 *     open an incident, or produce a visit_log that affects downstream
 *     views — refetch is the cheapest correct thing to do.
 *   - Revoke (<PassCard>) replaces the pass in our local list without a
 *     refetch; server state is authoritative so we'll reconcile on the
 *     next tab switch.
 *   - Vehicle lookup is by-plate (getByPlate), a single-row response.
 *     Blacklist/whitelist flips from <VehicleCard> swap the row in place.
 *
 * Session requirements: role ∈ {security, admin}.  We read `property_id`
 * from /auth/me (now resolved server-side via properties.slug join) — if
 * the session lacks one, the page falls back to a guidance alert rather
 * than calling verify with null.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Pass, PropertyType, Vehicle } from '../api/types';
import { api, isV1ApiError } from '../api';
import { useV1Session, isGuardRole, normalizeUserRole } from '../store';
import { ScanPanel } from '../components/ScanPanel';
import { PassCard } from '../components/PassCard';
import { VehicleCard } from '../components/VehicleCard';
import { getPropertyLabels, isCheckpointFirstProperty } from '../lib/propertyLabels';
import {
  Alert,
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
import { normalizePlate } from '../api';

type RightTab = 'passes' | 'vehicles';

export function GuardConsolePage() {
  const session = useV1Session();
  const navigate = useNavigate();
  const canGuard = isGuardRole(session.role);
  const canOnboard = ['property_admin', 'management_company_admin', 'platform_admin']
    .includes(normalizeUserRole(session.role));
  const propertyId = session.property_id ?? null;
  const labels = useMemo(() => getPropertyLabels(session.property_type), [session.property_type]);
  const checkpointFirst = isCheckpointFirstProperty(session.property_type);
  const [tab, setTab] = useState<RightTab>(checkpointFirst ? 'vehicles' : 'passes');
  const [refreshToken, setRefreshToken] = useState(0);

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
        <ScanPanel
          propertyId={propertyId}
          onVerified={() => setRefreshToken((t) => t + 1)}
        />

        <Stack>
          <div className={uiClasses.tabs} role="tablist" aria-label="Содержимое консоли">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'passes'}
              className={`${uiClasses.tab} ${tab === 'passes' ? uiClasses.tabActive : ''}`}
              onClick={() => setTab('passes')}
            >
              {labels.guardPassesTab}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'vehicles'}
              className={`${uiClasses.tab} ${tab === 'vehicles' ? uiClasses.tabActive : ''}`}
              onClick={() => setTab('vehicles')}
            >
              {labels.guardVehiclesTab}
            </button>
          </div>

          {tab === 'passes' ? <ActivePassesTab refreshToken={refreshToken} /> : null}
          {tab === 'vehicles' ? <VehicleLookupTab propertyType={session.property_type ?? null} /> : null}
        </Stack>
      </div>
    </div>
  );
}

// ─── Active passes tab ──────────────────────────────────────────────────────

interface ActivePassesTabProps {
  refreshToken: number;
}

function ActivePassesTab({ refreshToken }: ActivePassesTabProps) {
  const [passes, setPasses] = useState<Pass[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localRefresh, setLocalRefresh] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.passes.list({ status: 'active', limit: 30 });
      setPasses(res.passes);
    } catch (err) {
      setPasses(null);
      setError(isV1ApiError(err) ? err.message : 'Не удалось загрузить пропуски');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken, localRefresh]);

  const handleRevoked = useCallback((updated: Pass) => {
    setPasses((prev) => {
      if (!prev) return prev;
      // Replace the row; when the pass is no longer `active` it will fall
      // out of view on next refresh.  We keep it in the list for one more
      // render so the guard sees the transition and its revoked_reason.
      return prev.map((p) => (p.id === updated.id ? updated : p));
    });
  }, []);

  return (
    <Card
      title="Активные пропуски"
      actions={
        <Button variant="ghost" onClick={() => setLocalRefresh((t) => t + 1)}>
          Обновить
        </Button>
      }
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      {passes === null && !error ? (
        <Inline>
          <Spinner />
          <span className={uiClasses.textMuted}>Загрузка…</span>
        </Inline>
      ) : passes && passes.length === 0 ? (
        <EmptyState>Активных пропусков нет.</EmptyState>
      ) : passes ? (
        <Stack>
          {passes.map((p) => (
            <PassCard key={p.id} pass={p} onRevoked={handleRevoked} />
          ))}
        </Stack>
      ) : null}
    </Card>
  );
}

// ─── Vehicle lookup tab ─────────────────────────────────────────────────────

interface VehicleLookupTabProps {
  propertyType?: PropertyType | null;
}

function VehicleLookupTab({ propertyType }: VehicleLookupTabProps) {
  const labels = useMemo(() => getPropertyLabels(propertyType), [propertyType]);
  const [input, setInput] = useState('');
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = useMemo(() => (input ? normalizePlate(input) : ''), [input]);

  const search = useCallback(async () => {
    if (!normalized) {
      setError('Введите номер авто');
      return;
    }
    setSearching(true);
    setError(null);
    setVehicle(null);
    try {
      const res = await api.vehicles.getByPlate(normalized);
      setVehicle(res.vehicle);
    } catch (err) {
      if (isV1ApiError(err) && err.kind === 'not_found') {
        setError(`Авто «${normalized}» не найдено`);
      } else {
        setError(isV1ApiError(err) ? err.message : 'Не удалось выполнить поиск');
      }
    } finally {
      setSearching(false);
    }
  }, [normalized]);

  const handleChanged = useCallback((updated: Vehicle) => {
    setVehicle(updated);
  }, []);

  return (
    <Card title={labels.vehicleLookupTitle}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <Field
          label="Номер авто"
          id="v1-guard-plate"
          error={error ?? undefined}
          hint={labels.vehicleLookupHint}
        >
          <Input
            id="v1-guard-plate"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="A001AA77"
            autoComplete="off"
            disabled={searching}
          />
        </Field>
        <Inline>
          <Button type="submit" loading={searching}>
            Найти
          </Button>
          {vehicle || input ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setInput('');
                setVehicle(null);
                setError(null);
              }}
              disabled={searching}
            >
              Сбросить
            </Button>
          ) : null}
        </Inline>
      </form>

      {vehicle ? (
        <div className={uiClasses.marginTop3}>
          <VehicleCard vehicle={vehicle} onChanged={handleChanged} />
        </div>
      ) : null}
    </Card>
  );
}
