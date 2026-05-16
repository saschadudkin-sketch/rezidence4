/**
 * Resident-facing "create access request" form.
 *
 * Validation decisions:
 *   - vehicle_access REQUIRES vehicle_id (matches backend constraint)
 *   - starts_at < ends_at
 *   - starts_at must not be in the past beyond a 15-minute grace window
 *   - visitor_name is required for guest/courier/service
 *   - Field errors map onto either client-side `errors[field]` or the
 *     backend 400/422 `error` string (best-effort — backend returns one
 *     field at a time).
 */

import { FormEvent, useMemo, useState } from 'react';
import type {
  AccessRequest,
  AccessPoint,
  AccessZone,
  PassSummary,
  RequestType,
  UUID,
  Unit,
  Vehicle,
  PropertyType,
} from '../api/types';
import { accessRequestsApi } from '../api/accessRequests';
import { passesApi } from '../api/passes';
import type { CreateAccessRequestBody } from '../api/accessRequests';
import { isV1ApiError } from '../api';
import {
  Alert,
  Button,
  Field,
  Inline,
  Input,
  Select,
  Stack,
  Textarea,
  uiClasses,
} from './ui';
import { formatUnitLabel, getPropertyLabels } from '../lib/propertyLabels';

/**
 * Minimal unit shape the form needs — full Unit objects pass through too.
 * Residents can't read full unit rows from the backend, so we widen the
 * accepted type to just the label/id pair.
 */
export type UnitOption = Pick<Unit, 'id' | 'unit_number'> & Partial<Pick<Unit, 'unit_type'>>;
/** Same idea for vehicles — display label comes from plate/brand/model. */
export type VehicleOption = Pick<Vehicle, 'id' | 'plate_number' | 'brand' | 'model'>;

export interface AccessRequestFormProps {
  propertyId: UUID;
  propertyType?: PropertyType | null;
  units: readonly UnitOption[];
  vehicles: readonly VehicleOption[];
  zones?: readonly AccessZone[];
  points?: readonly AccessPoint[];
  /** Optional whitelist of request types to show. Default: all. */
  allowedRequestTypes?: ReadonlyArray<RequestType>;
  onCreated: (request: AccessRequest, pass?: PassSummary | null) => void;
  onCancel?: () => void;
}

type FormErrors = Partial<
  Record<
    | 'target_unit_id'
    | 'request_type'
    | 'visitor_name'
    | 'visitor_phone'
    | 'vehicle_id'
    | 'starts_at'
    | 'ends_at'
    | 'reason'
    | 'guest_instructions'
    | 'guard_notes'
    | '_root',
    string
  >
>;

const REQUEST_TYPE_OPTIONS: ReadonlyArray<{ value: RequestType; label: string }> = [
  { value: 'guest_access', label: 'Гость' },
  { value: 'courier_access', label: 'Курьер' },
  { value: 'service_access', label: 'Сервис' },
  { value: 'vehicle_access', label: 'Въезд авто' },
];

const WINDOW_PRESETS: ReadonlyArray<{ key: string; label: string; getWindow: () => { starts_at: string; ends_at: string } }> = [
  { key: 'two-hours', label: '2 часа', getWindow: () => windowFromNow(2) },
  { key: 'today', label: 'Сегодня', getWindow: defaultWindow },
  { key: 'tomorrow', label: 'Завтра', getWindow: () => dayWindow(1) },
  { key: 'end-of-day', label: 'До конца дня', getWindow: () => windowUntilEndOfDay(0) },
];

function defaultWindow(): { starts_at: string; ends_at: string } {
  const now = new Date();
  const rounded = new Date(Math.ceil(now.getTime() / (15 * 60_000)) * (15 * 60_000));
  const plusFour = new Date(rounded.getTime() + 4 * 60 * 60_000);
  return { starts_at: toLocalInput(rounded), ends_at: toLocalInput(plusFour) };
}

function roundedNow(): Date {
  const now = new Date();
  return new Date(Math.ceil(now.getTime() / (15 * 60_000)) * (15 * 60_000));
}

function windowFromNow(hours: number): { starts_at: string; ends_at: string } {
  const start = roundedNow();
  return { starts_at: toLocalInput(start), ends_at: toLocalInput(new Date(start.getTime() + hours * 60 * 60_000)) };
}

function windowUntilEndOfDay(offsetDays: number): { starts_at: string; ends_at: string } {
  const start = roundedNow();
  start.setDate(start.getDate() + offsetDays);
  const end = new Date(start);
  end.setHours(23, 59, 0, 0);
  return { starts_at: toLocalInput(start), ends_at: toLocalInput(end) };
}

function dayWindow(offsetDays: number): { starts_at: string; ends_at: string } {
  const start = roundedNow();
  start.setDate(start.getDate() + offsetDays);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 0, 0);
  return { starts_at: toLocalInput(start), ends_at: toLocalInput(end) };
}

function toLocalInput(d: Date): string {
  // datetime-local expects "YYYY-MM-DDTHH:mm" in local TZ.
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function localInputToIso(value: string): string {
  // Treat datetime-local as local time; convert to ISO for backend.
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

export function AccessRequestForm({
  propertyId,
  propertyType,
  units,
  vehicles,
  zones = [],
  points = [],
  allowedRequestTypes,
  onCreated,
  onCancel,
}: AccessRequestFormProps) {
  const initialWindow = useMemo(defaultWindow, []);
  const labels = useMemo(() => getPropertyLabels(propertyType), [propertyType]);
  const typeOptions = useMemo(
    () =>
      allowedRequestTypes
        ? REQUEST_TYPE_OPTIONS.filter((o) => allowedRequestTypes.includes(o.value))
        : REQUEST_TYPE_OPTIONS,
    [allowedRequestTypes],
  );
  const [targetUnitId, setTargetUnitId] = useState<UUID>(units[0]?.id ?? '');
  const [requestType, setRequestType] = useState<RequestType>(
    typeOptions[0]?.value ?? 'guest_access',
  );
  const [visitorName, setVisitorName] = useState('');
  const [visitorPhone, setVisitorPhone] = useState('');
  const [vehicleId, setVehicleId] = useState<UUID | ''>('');
  const [targetZoneId, setTargetZoneId] = useState<UUID | ''>('');
  const [targetPointId, setTargetPointId] = useState<UUID | ''>('');
  const [startsAt, setStartsAt] = useState(initialWindow.starts_at);
  const [endsAt, setEndsAt] = useState(initialWindow.ends_at);
  const [reason, setReason] = useState('');
  const [guestInstructions, setGuestInstructions] = useState('');
  const [guardNotes, setGuardNotes] = useState('');
  const [lastCreated, setLastCreated] = useState<{
    request: AccessRequest;
    pass: PassSummary | null;
    shareUrl: string | null;
    qrError: string | null;
  } | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const selectedZonePoints = useMemo(
    () => points.filter((point) => !targetZoneId || point.zone_id === targetZoneId),
    [points, targetZoneId],
  );

  function setWindowPreset(getWindow: () => { starts_at: string; ends_at: string }) {
    const next = getWindow();
    setStartsAt(next.starts_at);
    setEndsAt(next.ends_at);
  }

  function validate(): FormErrors {
    const e: FormErrors = {};
    if (!targetUnitId) e.target_unit_id = labels.unitSelectError;
    if (!typeOptions.some((o) => o.value === requestType)) {
      e.request_type = 'Некорректный тип заявки';
    }
    if (requestType !== 'vehicle_access' && !visitorName.trim()) {
      e.visitor_name = 'Укажите имя посетителя';
    }
    if (requestType === 'vehicle_access' && !vehicleId) {
      e.vehicle_id = 'Для vehicle_access нужно выбрать авто';
    }
    if (guestInstructions.trim().length > 1000) {
      e.guest_instructions = 'Инструкция слишком длинная';
    }
    if (guardNotes.trim().length > 1000) {
      e.guard_notes = 'Заметка слишком длинная';
    }
    const s = new Date(startsAt);
    const eDate = new Date(endsAt);
    if (!startsAt || Number.isNaN(s.getTime())) e.starts_at = 'Некорректная дата начала';
    if (!endsAt || Number.isNaN(eDate.getTime())) e.ends_at = 'Некорректная дата конца';
    if (!e.starts_at && !e.ends_at) {
      if (s.getTime() >= eDate.getTime()) {
        e.ends_at = 'Конец должен быть позже начала';
      }
      if (s.getTime() < Date.now() - 15 * 60_000) {
        e.starts_at = 'Начало не может быть более чем на 15 минут в прошлом';
      }
    }
    return e;
  }

  async function getShareUrl(passId: UUID): Promise<{ shareUrl: string | null; qrError: string | null }> {
    try {
      const qrRes = await passesApi.getQr(passId);
      return {
        shareUrl: `${window.location.origin}/p/${qrRes.qr.token}`,
        qrError: null,
      };
    } catch {
      return {
        shareUrl: null,
        qrError: 'Не удалось получить ссылку/QR. Попробуйте ещё раз.',
      };
    }
  }

  async function retryShareUrl() {
    if (!lastCreated?.pass?.id) return;
    setSubmitting(true);
    const qrState = await getShareUrl(lastCreated.pass.id);
    setLastCreated((prev) => (prev ? { ...prev, ...qrState } : prev));
    setSubmitting(false);
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const v = validate();
    setErrors(v);
    if (Object.keys(v).length > 0) return;

    setSubmitting(true);
    try {
      const body: CreateAccessRequestBody = {
        property_id: propertyId,
        target_unit_id: targetUnitId,
        target_zone_id: targetZoneId || null,
        target_point_id: targetPointId || null,
        request_type: requestType,
        starts_at: localInputToIso(startsAt),
        ends_at: localInputToIso(endsAt),
        visitor_name: visitorName.trim() || null,
        visitor_phone: visitorPhone.trim() || null,
        vehicle_id: vehicleId || null,
        reason: reason.trim() || null,
        guest_instructions: guestInstructions.trim() || null,
        guard_notes: guardNotes.trim() || null,
        share_delivery_channels: ['link', 'qr'],
      };
      const res = await accessRequestsApi.create(body);
      let qrState: { shareUrl: string | null; qrError: string | null } = {
        shareUrl: null,
        qrError: null,
      };
      if (res.pass?.id) {
        qrState = await getShareUrl(res.pass.id);
      }
      setLastCreated({ request: res.access_request, pass: res.pass ?? null, ...qrState });
      onCreated(res.access_request, res.pass ?? null);
    } catch (err) {
      if (isV1ApiError(err)) {
        if (err.kind === 'validation') {
          // Backend gives a free-form message; map common ones.
          const msg = err.message.toLowerCase();
          if (msg.includes('vehicle')) setErrors({ vehicle_id: err.message });
          else if (msg.includes('visitor')) setErrors({ visitor_name: err.message });
          else if (msg.includes('starts_at')) setErrors({ starts_at: err.message });
          else if (msg.includes('ends_at')) setErrors({ ends_at: err.message });
          else setErrors({ _root: err.message });
        } else {
          setErrors({ _root: err.message });
        }
      } else {
        setErrors({ _root: 'Не удалось создать заявку' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label="Новая заявка">
      <Stack>
        {errors._root ? <Alert tone="error">{errors._root}</Alert> : null}
        {lastCreated ? (
          <Alert tone="success">
            Заявка создана. {lastCreated.shareUrl ? (
              <>
                Ссылка для гостя: <a href={lastCreated.shareUrl} target="_blank" rel="noreferrer">{lastCreated.shareUrl}</a>
              </>
            ) : lastCreated.qrError && lastCreated.pass?.id ? (
              <>
                {lastCreated.qrError}{' '}
                <Button type="button" variant="ghost" onClick={retryShareUrl} disabled={submitting}>
                  Получить ссылку
                </Button>
              </>
            ) : lastCreated.request.status === 'approved' ? (
              'Пропуск одобрен, ссылка появится после выпуска QR.'
            ) : (
              'После одобрения здесь будет доступна ссылка /p/:token.'
            )}
          </Alert>
        ) : null}

        <Field label={labels.unitField} id="v1-ar-unit" error={errors.target_unit_id}>
          <Select
            id="v1-ar-unit"
            value={targetUnitId}
            onChange={(e) => setTargetUnitId(e.target.value)}
            disabled={submitting || units.length === 0}
          >
            {units.length === 0 ? (
              <option value="">{labels.noUnits}</option>
            ) : (
              units.map((u) => (
                <option key={u.id} value={u.id}>
                  {formatUnitLabel(u, propertyType)}
                </option>
              ))
            )}
          </Select>
        </Field>

        <Field label="Тип заявки" id="v1-ar-type" error={errors.request_type}>
          <Inline>
            {typeOptions.map((o) => (
              <Button
                key={o.value}
                type="button"
                variant={requestType === o.value ? 'primary' : 'ghost'}
                onClick={() => setRequestType(o.value)}
                disabled={submitting}
              >
                {o.label}
              </Button>
            ))}
          </Inline>
          <Select
            id="v1-ar-type"
            value={requestType}
            onChange={(e) => setRequestType(e.target.value as RequestType)}
            disabled={submitting}
          >
            {typeOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>

        {requestType !== 'vehicle_access' ? (
          <Field label="Имя посетителя" id="v1-ar-visitor" error={errors.visitor_name}>
            <Input
              id="v1-ar-visitor"
              value={visitorName}
              onChange={(e) => setVisitorName(e.target.value)}
              disabled={submitting}
              aria-label="Имя посетителя"
              placeholder="Иван Иванов"
            />
          </Field>
        ) : null}

        <Field label="Телефон (необязательно)" id="v1-ar-phone" error={errors.visitor_phone}>
          <Input
            id="v1-ar-phone"
            value={visitorPhone}
            onChange={(e) => setVisitorPhone(e.target.value)}
            disabled={submitting}
            aria-label="Телефон (необязательно)"
            placeholder="+7 999 000 00 00"
            inputMode="tel"
          />
        </Field>

        {requestType === 'vehicle_access' || vehicles.length > 0 ? (
          <Field
            label={requestType === 'vehicle_access' ? 'Авто' : 'Авто (необязательно)'}
            id="v1-ar-vehicle"
            error={errors.vehicle_id}
          >
            <Select
              id="v1-ar-vehicle"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value as UUID | '')}
              disabled={submitting}
            >
              <option value="">
                {requestType === 'vehicle_access' ? 'Выберите авто' : 'Без авто'}
              </option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plate_number}
                  {v.brand || v.model
                    ? ` — ${[v.brand, v.model].filter(Boolean).join(' ')}`
                    : ''}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {zones.length > 0 || points.length > 0 ? (
          <Inline>
            {zones.length > 0 ? (
              <Field label="Зона доступа" id="v1-ar-zone">
                <Select
                  id="v1-ar-zone"
                  value={targetZoneId}
                  onChange={(e) => {
                    setTargetZoneId(e.target.value as UUID | '');
                    setTargetPointId('');
                  }}
                  disabled={submitting}
                >
                  <option value="">Любая подходящая зона</option>
                  {zones.map((zone) => (
                    <option key={zone.id} value={zone.id}>{zone.name}</option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {points.length > 0 ? (
              <Field label="КПП / вход" id="v1-ar-point">
                <Select
                  id="v1-ar-point"
                  value={targetPointId}
                  onChange={(e) => setTargetPointId(e.target.value as UUID | '')}
                  disabled={submitting}
                >
                  <option value="">Любой подходящий вход</option>
                  {selectedZonePoints.map((point) => (
                    <option key={point.id} value={point.id}>{point.name}</option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </Inline>
        ) : null}

        <Inline>
          {WINDOW_PRESETS.map((preset) => (
            <Button
              key={preset.key}
              type="button"
              variant="ghost"
              onClick={() => setWindowPreset(preset.getWindow)}
              disabled={submitting}
            >
              {preset.label}
            </Button>
          ))}
        </Inline>
        <Inline>
          <Field label="Начало" id="v1-ar-start" error={errors.starts_at}>
            <Input
              id="v1-ar-start"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              disabled={submitting}
            />
          </Field>
          <Field label="Окончание" id="v1-ar-end" error={errors.ends_at}>
            <Input
              id="v1-ar-end"
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              disabled={submitting}
            />
          </Field>
        </Inline>

        <Field label="Комментарий (необязательно)" id="v1-ar-reason" error={errors.reason}>
          <Textarea
            id="v1-ar-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={submitting}
            aria-label="Комментарий (необязательно)"
            placeholder="Любая полезная информация для охраны"
          />
        </Field>

        <Field label="Инструкция для гостя (необязательно)" id="v1-ar-guest-instructions" error={errors.guest_instructions}>
          <Textarea
            id="v1-ar-guest-instructions"
            value={guestInstructions}
            onChange={(e) => setGuestInstructions(e.target.value)}
            disabled={submitting}
            aria-label="Инструкция для гостя (необязательно)"
            placeholder="Например: вход через северный КПП, назвать квартиру и показать QR"
          />
        </Field>

        <Field label="Заметка для охраны (необязательно)" id="v1-ar-guard-notes" error={errors.guard_notes}>
          <Textarea
            id="v1-ar-guard-notes"
            value={guardNotes}
            onChange={(e) => setGuardNotes(e.target.value)}
            disabled={submitting}
            aria-label="Заметка для охраны (необязательно)"
            placeholder="Видна только сотрудникам охраны"
          />
        </Field>

        <Inline className={uiClasses.marginTop2}>
          <Button type="submit" loading={submitting}>
            Создать заявку
          </Button>
          {lastCreated ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setLastCreated(null)}
              disabled={submitting}
            >
              Создать похожую
            </Button>
          ) : null}
          {onCancel ? (
            <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
              Отмена
            </Button>
          ) : null}
        </Inline>
      </Stack>
    </form>
  );
}
