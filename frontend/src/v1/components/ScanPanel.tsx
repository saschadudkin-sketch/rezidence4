/**
 * Guard-console scan panel — QR token or plate input → /visits/verify.
 *
 * Stays self-contained: it owns its verdict-cache.  Parent supplies the
 * property_id and optional onVerified callback (to bubble up the verdict
 * for invalidations — revoked passes, etc.).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { accessTopologyApi } from '../api/accessTopology';
import { securityWorkspaceApi } from '../api/securityWorkspace';
import { visitsApi } from '../api/visits';
import type {
  AccessPoint,
  ManualDecision,
  ManualDecisionDegradedReason,
  ManualDecisionLookupState,
  SecurityOfflineReplayEvent,
  UUID,
  VerifyDirection,
  VerifyMode,
  VerifyResult,
} from '../api/types';
import { Alert, Badge, Button, Card, Field, Inline, Input, Select, Stack, Textarea, uiClasses } from './ui';
import { VerifyResultCard } from './VerifyResultCard';
import { isV1ApiError } from '../api';
import { normalizePlate } from '../api/vehicles';

export interface ScanPanelProps {
  propertyId: UUID;
  onVerified?: (
    result: VerifyResult,
    request: { mode: GuardActionMode; value: string; access_point_id: UUID | null; direction: VerifyDirection },
  ) => void;
}

type GuardActionMode = VerifyMode | ManualDecision;

interface HistoryItem {
  at: string;
  mode: GuardActionMode;
  value: string;
  pointName?: string;
  direction: VerifyDirection;
  allowed: boolean;
  reason?: string;
}

const DIRECTION_LABELS: Record<VerifyDirection, string> = {
  entry: 'Въезд',
  exit: 'Выезд',
};

const ACTION_LABELS: Record<GuardActionMode, string> = {
  qr: 'QR',
  plate: 'Plate',
  manual_admit: 'Manual admit',
  manual_deny: 'Manual deny',
};

const OFFLINE_QUEUE_PREFIX = 'rz:v1:security-offline:';

function offlineQueueKey(propertyId: UUID): string {
  return `${OFFLINE_QUEUE_PREFIX}${propertyId}`;
}

function readOfflineQueue(propertyId: UUID): SecurityOfflineReplayEvent[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(offlineQueueKey(propertyId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SecurityOfflineReplayEvent =>
      Boolean(item && typeof item === 'object' && typeof item.client_event_id === 'string'),
    );
  } catch {
    return [];
  }
}

function writeOfflineQueue(propertyId: UUID, events: SecurityOfflineReplayEvent[]) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(offlineQueueKey(propertyId), JSON.stringify(events.slice(0, 100)));
  } catch {
    // Storage may be unavailable in private mode. Keep in-memory queue alive.
  }
}

function newClientEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `offline-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function shouldQueueOffline(err: unknown): boolean {
  return isBrowserOffline()
    || (isV1ApiError(err) && (err.kind === 'network' || err.kind === 'timeout'));
}

export function ScanPanel({ propertyId, onVerified }: ScanPanelProps) {
  const [mode, setMode] = useState<VerifyMode>('qr');
  const [direction, setDirection] = useState<VerifyDirection>('entry');
  const [value, setValue] = useState('');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [points, setPoints] = useState<AccessPoint[]>([]);
  const [selectedPointId, setSelectedPointId] = useState<UUID | ''>('');
  const [loadingPoints, setLoadingPoints] = useState(false);
  const [pointError, setPointError] = useState<string | null>(null);
  const [manualDecision, setManualDecision] = useState<ManualDecision>('manual_admit');
  const [manualPersonLabel, setManualPersonLabel] = useState('');
  const [manualPlate, setManualPlate] = useState('');
  const [manualReason, setManualReason] = useState('');
  const [manualDegraded, setManualDegraded] = useState(false);
  const [manualLookupState, setManualLookupState] = useState<ManualDecisionLookupState>('online');
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [offlineQueue, setOfflineQueue] = useState<SecurityOfflineReplayEvent[]>([]);
  const [offlineSyncing, setOfflineSyncing] = useState(false);
  const [offlineError, setOfflineError] = useState<string | null>(null);

  const persistOfflineQueue = useCallback((events: SecurityOfflineReplayEvent[]) => {
    setOfflineQueue(events);
    writeOfflineQueue(propertyId, events);
  }, [propertyId]);

  const pushOfflineEvent = useCallback((event: SecurityOfflineReplayEvent) => {
    persistOfflineQueue([event, ...offlineQueue].slice(0, 100));
  }, [offlineQueue, persistOfflineQueue]);

  const syncOfflineQueue = useCallback(async () => {
    if (offlineQueue.length === 0 || offlineSyncing || isBrowserOffline()) return;
    setOfflineSyncing(true);
    setOfflineError(null);
    try {
      const res = await securityWorkspaceApi.offlineReplay({
        property_id: propertyId,
        events: offlineQueue,
      });
      const acceptedIds = new Set(res.results.map((item) => item.replay_event.client_event_id));
      persistOfflineQueue(offlineQueue.filter((event) => !acceptedIds.has(event.client_event_id)));
    } catch (err) {
      setOfflineError(isV1ApiError(err) ? err.message : 'Не удалось синхронизировать offline-очередь');
    } finally {
      setOfflineSyncing(false);
    }
  }, [offlineQueue, offlineSyncing, persistOfflineQueue, propertyId]);

  useEffect(() => {
    let cancelled = false;

    async function loadPoints() {
      setLoadingPoints(true);
      setPointError(null);
      try {
        const res = await accessTopologyApi.listPoints({
          property_id: propertyId,
          is_active: true,
          limit: 100,
        });
        if (cancelled) return;
        setPoints(res.points);
        setSelectedPointId((prev) => {
          if (prev && res.points.some((point) => point.id === prev)) return prev;
          return res.points[0]?.id ?? '';
        });
      } catch (err) {
        if (cancelled) return;
        setPoints([]);
        setSelectedPointId('');
        setPointError(isV1ApiError(err) ? err.message : 'Не удалось загрузить КПП');
      } finally {
        if (!cancelled) setLoadingPoints(false);
      }
    }

    void loadPoints();
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  useEffect(() => {
    persistOfflineQueue(readOfflineQueue(propertyId));
  }, [persistOfflineQueue, propertyId]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onOnline = () => {
      void syncOfflineQueue();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [syncOfflineQueue]);

  const selectedPoint = useMemo(
    () => points.find((point) => point.id === selectedPointId) ?? null,
    [points, selectedPointId],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      setError(mode === 'qr' ? 'Введите QR-токен' : 'Введите номер авто');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body =
        mode === 'qr'
          ? {
            property_id: propertyId,
            mode,
            token: trimmed,
            access_point_id: selectedPointId || null,
            direction,
          }
          : {
            property_id: propertyId,
            mode,
            plate: normalizePlate(trimmed),
            access_point_id: selectedPointId || null,
            direction,
          };
      const res = await visitsApi.verify(body);
      setResult(res);
      setHistory((prev) =>
        [
          {
            at: new Date().toISOString(),
            mode,
            value: mode === 'plate' ? normalizePlate(trimmed) : trimmed,
            pointName: selectedPoint?.name,
            direction,
            allowed: res.allowed,
            reason: res.reason,
          },
          ...prev,
        ].slice(0, 20),
      );
      onVerified?.(res, { mode, value: trimmed, access_point_id: selectedPointId || null, direction });
      setValue('');
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось выполнить проверку');
      setResult(null);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitManualDecision(e: React.FormEvent) {
    e.preventDefault();
    const reason = manualReason.trim();
    const personLabel = manualPersonLabel.trim();
    const plate = manualPlate.trim() ? normalizePlate(manualPlate) : '';
    const subjectLabel = personLabel || plate;

    if (!subjectLabel) {
      setManualError('Укажите посетителя или номер авто');
      return;
    }
    if (!reason) {
      setManualError('Укажите причину решения');
      return;
    }

    setManualSubmitting(true);
    setManualError(null);
    setOfflineError(null);
    try {
      const occurredAt = new Date().toISOString();
      const body = {
        property_id: propertyId,
        access_point_id: selectedPointId || null,
        decision: manualDecision,
        direction,
        reason,
        person_label: personLabel || null,
        vehicle_plate: plate || null,
        degraded_mode: manualDegraded,
        degraded_reason: manualDegraded ? manualDecision : null,
        lookup_state: manualLookupState,
        occurred_at: occurredAt,
      };
      const buildOfflineEvent = (
        degradedReason: ManualDecisionDegradedReason,
      ): SecurityOfflineReplayEvent => ({
        ...body,
        client_event_id: newClientEventId(),
        event_type: manualDecision,
        degraded_mode: true,
        degraded_reason: degradedReason,
        lookup_state: manualLookupState === 'online' ? 'not_checked' : manualLookupState,
        occurred_at: occurredAt,
      });
      const rememberQueuedDecision = (event: SecurityOfflineReplayEvent) => {
        const syntheticResult: VerifyResult = {
          allowed: manualDecision === 'manual_admit',
          reason: manualDecision === 'manual_deny' ? 'manual_deny' : undefined,
          direction,
          visit_log_id: null,
          incident_id: null,
          pass: null,
        };
        setResult(syntheticResult);
        setHistory((prev) =>
          [
            {
              at: occurredAt,
              mode: manualDecision,
              value: subjectLabel,
              pointName: selectedPoint?.name,
              direction,
              allowed: manualDecision === 'manual_admit',
              reason: `${reason} · offline ${event.client_event_id.slice(0, 8)}`,
            },
            ...prev,
          ].slice(0, 20),
        );
        setOfflineError('Связь недоступна: решение сохранено локально и будет отправлено при восстановлении.');
        setManualPersonLabel('');
        setManualPlate('');
        setManualReason('');
      };

      if (isBrowserOffline()) {
        const event = buildOfflineEvent('connectivity_loss');
        pushOfflineEvent(event);
        rememberQueuedDecision(event);
        return;
      }

      const res = await securityWorkspaceApi.manualDecision(body);
      const syntheticResult: VerifyResult = {
        allowed: manualDecision === 'manual_admit',
        reason: manualDecision === 'manual_deny' ? 'manual_deny' : undefined,
        direction,
        visit_log_id: res.visit_log.id,
        incident_id: res.incident.id,
        pass: null,
      };
      setResult(syntheticResult);
      setHistory((prev) =>
        [
          {
            at: new Date().toISOString(),
            mode: manualDecision,
            value: subjectLabel,
            pointName: selectedPoint?.name,
            direction,
            allowed: manualDecision === 'manual_admit',
            reason,
          },
          ...prev,
        ].slice(0, 20),
      );
      onVerified?.(syntheticResult, {
        mode: manualDecision,
        value: subjectLabel,
        access_point_id: selectedPointId || null,
        direction,
      });
      setManualPersonLabel('');
      setManualPlate('');
      setManualReason('');
    } catch (err) {
      if (shouldQueueOffline(err)) {
        const event: SecurityOfflineReplayEvent = {
          property_id: propertyId,
          access_point_id: selectedPointId || null,
          decision: manualDecision,
          direction,
          reason,
          person_label: personLabel || null,
          vehicle_plate: plate || null,
          degraded_mode: true,
          degraded_reason: 'connectivity_loss',
          lookup_state: manualLookupState === 'online' ? 'unavailable' : manualLookupState,
          occurred_at: new Date().toISOString(),
          client_event_id: newClientEventId(),
          event_type: manualDecision,
        };
        pushOfflineEvent(event);
        const syntheticResult: VerifyResult = {
          allowed: manualDecision === 'manual_admit',
          reason: manualDecision === 'manual_deny' ? 'manual_deny' : undefined,
          direction,
          visit_log_id: null,
          incident_id: null,
          pass: null,
        };
        setResult(syntheticResult);
        setHistory((prev) =>
          [
            {
              at: event.occurred_at,
              mode: manualDecision,
              value: subjectLabel,
              pointName: selectedPoint?.name,
              direction,
              allowed: manualDecision === 'manual_admit',
              reason: `${reason} · offline ${event.client_event_id.slice(0, 8)}`,
            },
            ...prev,
          ].slice(0, 20),
        );
        setOfflineError('Решение сохранено в offline-очередь после сетевой ошибки.');
        setManualPersonLabel('');
        setManualPlate('');
        setManualReason('');
        return;
      }
      setManualError(isV1ApiError(err) ? err.message : 'Не удалось записать ручное решение');
      setResult(null);
    } finally {
      setManualSubmitting(false);
    }
  }

  return (
    <Stack>
      {offlineQueue.length > 0 || offlineError ? (
        <Alert tone={offlineError ? 'warning' : 'info'}>
          <Inline>
            <span>
              Offline-очередь: {offlineQueue.length}
              {offlineError ? ` · ${offlineError}` : ''}
            </span>
            {offlineQueue.length > 0 ? (
              <Button
                type="button"
                variant="secondary"
                loading={offlineSyncing}
                disabled={offlineSyncing || isBrowserOffline()}
                onClick={() => void syncOfflineQueue()}
              >
                Синхронизировать
              </Button>
            ) : null}
          </Inline>
        </Alert>
      ) : null}
      <Card title="Сканирование">
        <form onSubmit={submit}>
          <Field
            label="КПП / точка доступа"
            hint={pointError ?? (loadingPoints ? 'Загрузка КПП…' : undefined)}
            error={pointError ? pointError : undefined}
          >
            <Select
              aria-label="КПП / точка доступа"
              value={selectedPointId}
              onChange={(e) => setSelectedPointId(e.target.value as UUID | '')}
              disabled={loadingPoints || submitting}
            >
              {points.length === 0 ? <option value="">Без выбранной точки</option> : null}
              {points.map((point) => (
                <option key={point.id} value={point.id}>
                  {point.name} · {point.point_type}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Направление">
            <div className={uiClasses.tabs} role="group" aria-label="Направление прохода">
              {(['entry', 'exit'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={direction === item}
                  className={`${uiClasses.tab} ${direction === item ? uiClasses.tabActive : ''}`}
                  onClick={() => setDirection(item)}
                  disabled={submitting || manualSubmitting}
                >
                  {DIRECTION_LABELS[item]}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Режим" hint="QR-токен — для пропуска гостя. Plate — для въезда авто.">
            <Select aria-label="Режим сканирования" value={mode} onChange={(e) => setMode(e.target.value as VerifyMode)}>
              <option value="qr">QR-токен</option>
              <option value="plate">Гос. номер</option>
            </Select>
          </Field>
          <Field
            label={mode === 'qr' ? 'QR-токен' : 'Гос. номер'}
            error={error}
            hint={
              mode === 'plate'
                ? 'Ввод автоматически приводится к верхнему регистру'
                : 'Токен — 32-значная hex-строка'
            }
          >
            <Input
              aria-label={mode === 'qr' ? 'QR-токен' : 'Гос. номер'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={mode === 'qr' ? 'например, a7b8…' : 'например, A001AA77'}
              disabled={submitting}
              autoFocus
            />
          </Field>
          <Inline>
            <Button type="submit" loading={submitting}>
              Проверить
            </Button>
            {result ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setResult(null);
                  setValue('');
                }}
                disabled={submitting}
              >
                Сбросить
              </Button>
            ) : null}
          </Inline>
        </form>
      </Card>

      <Card
        title="Ручное решение"
        actions={manualDegraded ? <Badge tone="warning">Degraded</Badge> : <Badge tone="neutral">Online</Badge>}
      >
        <form onSubmit={submitManualDecision}>
          <Field label="Решение" error={manualError}>
            <div className={uiClasses.tabs} role="group" aria-label="Ручное решение">
              {(['manual_admit', 'manual_deny'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={manualDecision === item}
                  className={`${uiClasses.tab} ${manualDecision === item ? uiClasses.tabActive : ''}`}
                  onClick={() => setManualDecision(item)}
                  disabled={manualSubmitting || submitting}
                >
                  {item === 'manual_admit' ? 'Пропустить' : 'Запретить'}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Посетитель">
            <Input
              value={manualPersonLabel}
              onChange={(e) => setManualPersonLabel(e.target.value)}
              placeholder="ФИО, подрядчик или описание"
              disabled={manualSubmitting}
            />
          </Field>
          <Field label="Гос. номер">
            <Input
              value={manualPlate}
              onChange={(e) => setManualPlate(e.target.value)}
              placeholder="A001AA77"
              autoComplete="off"
              disabled={manualSubmitting}
            />
          </Field>
          <Field label="Причина">
            <Textarea
              value={manualReason}
              onChange={(e) => setManualReason(e.target.value)}
              placeholder="Коротко зафиксируйте основание"
              disabled={manualSubmitting}
            />
          </Field>
          <fieldset className={uiClasses.checkboxGroup}>
            <legend className={uiClasses.checkboxLegend}>Degraded mode</legend>
            <label className={uiClasses.label}>
              <input
                type="checkbox"
                checked={manualDegraded}
                onChange={(e) => {
                  setManualDegraded(e.target.checked);
                  setManualLookupState(e.target.checked ? 'not_checked' : 'online');
                }}
                disabled={manualSubmitting}
              />{' '}
              КПП в degraded mode
            </label>
          </fieldset>
          {manualDegraded ? (
            <Field label="Lookup state">
              <Select
                value={manualLookupState}
                onChange={(e) => setManualLookupState(e.target.value as ManualDecisionLookupState)}
                disabled={manualSubmitting}
              >
                <option value="not_checked">not checked</option>
                <option value="cached_hit">cached hit</option>
                <option value="cached_miss">cached miss</option>
                <option value="unavailable">unavailable</option>
              </Select>
            </Field>
          ) : null}
          <Inline>
            <Button
              type="submit"
              loading={manualSubmitting}
              variant={manualDecision === 'manual_deny' ? 'danger' : 'primary'}
            >
              Записать
            </Button>
            {manualPersonLabel || manualPlate || manualReason ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setManualPersonLabel('');
                  setManualPlate('');
                  setManualReason('');
                  setManualError(null);
                }}
                disabled={manualSubmitting}
              >
                Очистить
              </Button>
            ) : null}
          </Inline>
        </form>
      </Card>

      {result ? <VerifyResultCard result={result} /> : null}

      {history.length > 0 ? (
        <Card title="История сканирований (текущая сессия)">
          <ul className={uiClasses.timeline}>
            {history.map((h, idx) => (
              <li key={`${h.at}-${idx}`} className={uiClasses.timelineItem}>
                <span className={uiClasses.timelineTime}>
                  {new Date(h.at).toLocaleTimeString('ru-RU')}
                </span>
                <span className={uiClasses.timelineBody}>
                  <strong>{ACTION_LABELS[h.mode]}</strong> · {DIRECTION_LABELS[h.direction]} · {h.value} ·{' '}
                  {h.pointName ? `${h.pointName} · ` : ''}
                  {h.allowed ? '✓ разрешено' : `✕ ${h.reason ?? 'deny'}`}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Alert tone="info">
          Подтверждения сканирования появятся здесь. Список хранится в памяти вкладки — при
          перезагрузке очищается.
        </Alert>
      )}
    </Stack>
  );
}
