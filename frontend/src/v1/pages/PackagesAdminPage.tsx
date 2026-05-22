/**
 * PackagesAdminPage — staff/admin console для packages_v2.
 *
 * Что умеет первая итерация:
 *   - Листать посылки объекта (`GET /packages?property_id=...`) с фильтром по
 *     статусу (awaiting_pickup / picked_up / returned / lost / all).
 *   - Принимать новую посылку через inline-форму: unit_id, recipient_name,
 *     sender, carrier, tracking, size, storage_location, notes.
 *   - Выдавать посылку (POST /pickup) — имя получателя вручную или выбор
 *     из reсидентов; backend валидирует exactly-one-of.
 *   - Возвращать (POST /return) с причиной.
 *   - Mark-lost (admin only) с обязательным reason + confirm:true.
 *   - Напоминать резиденту (POST /remind) — rate-limit 1/hour на бэкенде.
 *
 * Что НЕ делает (следующие iterations):
 *   - PATCH metadata (carrier/tracking fix after receive).
 *   - Подсказки резидентов по unit (используем raw UUID + имя строкой).
 *   - Photo upload (пока ссылка на /uploads/* готовая).
 *   - Metrics dashboard (есть endpoint getMetrics, UI вынесем в общий dashboard).
 *
 * RBAC:
 *   Роут защищён package-specific RoleGate в V1Router.
 *   security видит приём/выдачу; concierge/admin дополнительно видят
 *   return/remind; mark-lost скрыт у non-admin.
 */

import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, isV1ApiError, packageStatusTone } from '../api';
import type {
  CreatePackageBody,
  Package,
  PackageSize,
  PackageStatus,
  PropertyType,
  Unit,
  UUID,
} from '../api';
import { normalizeUserRole, useV1Session, qk, invalidatePackage } from '../store';
import { getPropertyLabels } from '../lib/propertyLabels';
import { OperationsNav } from '../components/OperationsNav';
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
  Toolbar,
  uiClasses,
} from '../components/ui';

// ─── Constants mirroring backend ALLOWED_* arrays ──────────────────────────

const STATUS_FILTERS: ReadonlyArray<PackageStatus | 'all'> = [
  'all',
  'awaiting_pickup',
  'picked_up',
  'returned',
  'lost',
];

const STATUS_LABELS: Record<PackageStatus, string> = {
  awaiting_pickup: 'ждёт выдачи',
  picked_up:       'выдана',
  returned:        'возвращена',
  lost:            'утеряна',
};

const SIZES: readonly PackageSize[] = [
  'envelope',
  'small',
  'medium',
  'large',
  'oversize',
];

const SIZE_LABELS: Record<PackageSize, string> = {
  envelope: 'конверт',
  small:    'маленькая',
  medium:   'средняя',
  large:    'большая',
  oversize: 'негабарит',
};

// ─── Page ───────────────────────────────────────────────────────────────────

export function PackagesAdminPage() {
  const user = useV1Session();
  const propertyId = user.property_id ?? null;
  const role = normalizeUserRole(user.role);
  const isAdmin = [
    'property_admin',
    'management_company_admin',
    'platform_admin',
  ].includes(role);
  const canReturnOrRemind = role === 'concierge' || isAdmin;

  const [statusFilter, setStatusFilter] = useState<PackageStatus | 'all'>('awaiting_pickup');
  const [formOpen, setFormOpen] = useState(false);

  if (!propertyId) {
    return (
      <div className={uiClasses.pageShell}>
        <header className={uiClasses.pageHeader}>
          <h1 className={uiClasses.pageTitle}>Посылки</h1>
          <OperationsNav />
        </header>
        <Alert tone="warning">
          Вашему staff-аккаунту не назначен объект (property). Попросите
          администратора привязать ваш `property_slug` в настройках пользователя,
          затем обновите страницу.
        </Alert>
      </div>
    );
  }

  return (
    <div className={uiClasses.pageShell} data-testid="packages-admin-page">
      <header className={uiClasses.pageHeader}>
        <h1 className={uiClasses.pageTitle}>Посылки</h1>
        <p className={uiClasses.pageSubtitle}>
          Приём посылок на ресепшн, выдача резидентам и журнал.
        </p>
        <OperationsNav />
      </header>

      <Stack>
        <Toolbar>
          <Inline>
            <label className={uiClasses.label} htmlFor="pkg-status">Статус:</label>
            <Select
              id="pkg-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as PackageStatus | 'all')}
            >
              {STATUS_FILTERS.map((s) => (
                <option key={s} value={s}>
                  {s === 'all' ? 'все' : STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Inline>
          <Button variant="primary" onClick={() => setFormOpen((v) => !v)}>
            {formOpen ? 'Скрыть форму' : '+ Принять посылку'}
          </Button>
        </Toolbar>

        {formOpen ? (
          <CreatePackageForm
            propertyId={propertyId}
            propertyType={user.property_type ?? null}
            onCreated={() => setFormOpen(false)}
          />
        ) : null}

        <PackagesList
          status={statusFilter}
          isAdmin={isAdmin}
          canReturnOrRemind={canReturnOrRemind}
        />
      </Stack>
    </div>
  );
}

// ─── List ───────────────────────────────────────────────────────────────────

interface PackagesListProps {
  status: PackageStatus | 'all';
  isAdmin: boolean;
  canReturnOrRemind: boolean;
}

function PackagesList({ status, isAdmin, canReturnOrRemind }: PackagesListProps) {
  const params = useMemo(
    () => (status === 'all' ? undefined : { status }),
    [status],
  );

  const query = useQuery({
    queryKey: qk.packages.list(params),
    queryFn: ({ signal }) => api.packages.list(params, { signal }),
  });

  if (query.isLoading) {
    return (
      <Card>
        <Inline><Spinner /><span className={uiClasses.textMuted}>Загрузка…</span></Inline>
      </Card>
    );
  }

  if (query.isError) {
    const msg = isV1ApiError(query.error) ? query.error.message : 'Неизвестная ошибка';
    return <Alert tone="error">Не удалось загрузить список: {msg}</Alert>;
  }

  const items = query.data?.packages ?? [];
  if (!items.length) {
    return <EmptyState>Нет посылок с выбранным статусом.</EmptyState>;
  }

  return (
    <Stack>
      {items.map((p) => (
        <PackageRow
          key={p.id}
          row={p}
          isAdmin={isAdmin}
          canReturnOrRemind={canReturnOrRemind}
        />
      ))}
    </Stack>
  );
}

// ─── Single package card with actions ──────────────────────────────────────

interface PackageRowProps {
  row: Package;
  isAdmin: boolean;
  canReturnOrRemind: boolean;
}

function PackageRow({ row, isAdmin, canReturnOrRemind }: PackageRowProps) {
  const qc = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);
  const [mode, setMode] = useState<'none' | 'pickup' | 'return' | 'lost'>('none');
  const tone = packageStatusTone(row.status);

  const pickup = useMutation({
    mutationFn: (body: { picked_up_by_name: string }) =>
      api.packages.pickup(row.id, body),
    onSuccess: () => {
      setActionError(null);
      setActionOk('Посылка выдана');
      setMode('none');
      void invalidatePackage(qc, row.id);
    },
    onError: (err) => setActionError(packageActionError(err, 'Ошибка выдачи')),
  });

  const ret = useMutation({
    mutationFn: (body: { reason?: string }) => api.packages.return(row.id, body),
    onSuccess: () => {
      setActionError(null);
      setActionOk('Отмечено как возврат отправителю');
      setMode('none');
      void invalidatePackage(qc, row.id);
    },
    onError: (err) => setActionError(packageActionError(err, 'Ошибка возврата')),
  });

  const markLost = useMutation({
    mutationFn: (body: { reason: string }) =>
      api.packages.markLost(row.id, { confirm: true, reason: body.reason }),
    onSuccess: () => {
      setActionError(null);
      setActionOk('Отмечено как утерянная');
      setMode('none');
      void invalidatePackage(qc, row.id);
    },
    onError: (err) => setActionError(packageActionError(err, 'Ошибка отметки об утере')),
  });

  const remind = useMutation({
    mutationFn: () => api.packages.remind(row.id),
    onSuccess: (r) => {
      setActionError(null);
      setActionOk(`Напоминание отправлено (${r.outbox_fanout} канал(ов))`);
      void invalidatePackage(qc, row.id);
    },
    onError: (err) => setActionError(packageActionError(err, 'Ошибка напоминания')),
  });

  const busy =
    pickup.isPending || ret.isPending || markLost.isPending || remind.isPending;

  const isAwaiting = row.status === 'awaiting_pickup';
  const recipient =
    row.recipient_name_snapshot || row.picked_up_by_name || '—';

  return (
    <div
      data-testid="package-row"
      data-package-id={row.id}
      data-package-status={row.status}
      data-tracking-number={row.tracking_number ?? undefined}
    >
      <Card
        title={
          <Inline>
            <span>{row.carrier ? `${row.carrier}` : 'Посылка'}</span>
            {row.tracking_number ? (
              <span className={uiClasses.textMuted}>№ {row.tracking_number}</span>
            ) : null}
          </Inline>
        }
        subtitle={
          <Inline>
            <Badge tone={tone}>{STATUS_LABELS[row.status]}</Badge>
            {row.size_category ? (
              <span className={uiClasses.textMuted}>размер: {SIZE_LABELS[row.size_category]}</span>
            ) : null}
            <span className={uiClasses.textMuted}>
              принято: {new Date(row.received_at).toLocaleString('ru-RU')}
            </span>
            {row.storage_location ? (
              <span className={uiClasses.textMuted}>ячейка: {row.storage_location}</span>
            ) : null}
          </Inline>
        }
        actions={
          <Inline>
            {isAwaiting ? (
              <>
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => setMode(mode === 'pickup' ? 'none' : 'pickup')}
                >
                  Выдать
                </Button>
                {canReturnOrRemind ? (
                  <>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => setMode(mode === 'return' ? 'none' : 'return')}
                    >
                      Возврат
                    </Button>
                    <Button
                      variant="ghost"
                      loading={remind.isPending}
                      disabled={busy}
                      onClick={() => remind.mutate()}
                    >
                      Напомнить
                    </Button>
                  </>
                ) : null}
                {isAdmin ? (
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => setMode(mode === 'lost' ? 'none' : 'lost')}
                  >
                    Утеряна
                  </Button>
                ) : null}
              </>
            ) : null}
          </Inline>
        }
      >
        <Stack>
          <Inline>
            <span className={uiClasses.textMuted}>Получатель:</span>
            <span>{recipient}</span>
          </Inline>
          {row.sender_name ? (
            <Inline>
              <span className={uiClasses.textMuted}>Отправитель:</span>
              <span>{row.sender_name}</span>
            </Inline>
          ) : null}
          {row.notes ? (
            <p className={uiClasses.preWrap}>{row.notes}</p>
          ) : null}

          {mode === 'pickup' ? (
            <PickupForm
              onCancel={() => setMode('none')}
              onSubmit={(name) => pickup.mutate({ picked_up_by_name: name })}
              pending={pickup.isPending}
            />
          ) : null}

          {mode === 'return' ? (
            <ReturnForm
              onCancel={() => setMode('none')}
              onSubmit={(reason) => ret.mutate({ reason })}
              pending={ret.isPending}
            />
          ) : null}

          {mode === 'lost' ? (
            <LostForm
              onCancel={() => setMode('none')}
              onSubmit={(reason) => markLost.mutate({ reason })}
              pending={markLost.isPending}
            />
          ) : null}

          {actionOk ? <Alert tone="success">{actionOk}</Alert> : null}
          {actionError ? <Alert tone="error">{actionError}</Alert> : null}
        </Stack>
      </Card>
    </div>
  );
}

function packageActionError(err: unknown, fallback: string): string {
  if (!isV1ApiError(err)) return fallback;
  if (err.kind === 'conflict') {
    return 'Посылка уже обработана. Обновите список и проверьте текущий статус.';
  }
  if (err.kind === 'forbidden') {
    return 'У вашей роли нет прав на это действие.';
  }
  if (err.kind === 'rate_limited') {
    return err.message || 'Напоминание уже отправлено. Подождите час.';
  }
  return err.message || fallback;
}

// ─── Sub-forms for state transitions ───────────────────────────────────────

interface PickupFormProps {
  onCancel: () => void;
  onSubmit: (name: string) => void;
  pending: boolean;
}

function PickupForm({ onCancel, onSubmit, pending }: PickupFormProps) {
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setErr('Укажите имя получателя');
      return;
    }
    onSubmit(trimmed);
  }

  return (
    <form data-testid="package-pickup-form" onSubmit={submit}>
      <Stack>
        <Field id="pickup-name" label="Имя получателя (ФИО)">
          <Input
            id="pickup-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setErr(null);
            }}
            placeholder="Например: Иванов И.И."
            required
          />
        </Field>
        {err ? <Alert tone="error">{err}</Alert> : null}
        <Inline>
          <Button type="submit" variant="primary" loading={pending} disabled={pending}>
            Выдать
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
            Отмена
          </Button>
        </Inline>
      </Stack>
    </form>
  );
}

interface ReturnFormProps {
  onCancel: () => void;
  onSubmit: (reason: string) => void;
  pending: boolean;
}

function ReturnForm({ onCancel, onSubmit, pending }: ReturnFormProps) {
  const [reason, setReason] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit(reason.trim() || 'Не востребовано');
  }

  return (
    <form onSubmit={submit}>
      <Stack>
        <Field id="return-reason" label="Причина возврата">
          <Input
            id="return-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Например: «Срок хранения истёк»"
          />
        </Field>
        <Inline>
          <Button type="submit" variant="secondary" loading={pending} disabled={pending}>
            Оформить возврат
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
            Отмена
          </Button>
        </Inline>
      </Stack>
    </form>
  );
}

interface LostFormProps {
  onCancel: () => void;
  onSubmit: (reason: string) => void;
  pending: boolean;
}

function LostForm({ onCancel, onSubmit, pending }: LostFormProps) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setErr('Укажите причину утери (минимум 3 символа)');
      return;
    }
    if (!confirm('Отметить посылку как утерянную? Действие необратимо.')) return;
    onSubmit(trimmed);
  }

  return (
    <form onSubmit={submit}>
      <Stack>
        <Alert tone="warning">
          Операция необратима. Статус переходит в terminal-состояние «утеряна».
        </Alert>
        <Field id="lost-reason" label="Причина утери (обязательно)">
          <Textarea
            id="lost-reason"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setErr(null);
            }}
            rows={3}
            required
          />
        </Field>
        {err ? <Alert tone="error">{err}</Alert> : null}
        <Inline>
          <Button type="submit" variant="danger" loading={pending} disabled={pending}>
            Подтвердить утерю
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
            Отмена
          </Button>
        </Inline>
      </Stack>
    </form>
  );
}

// ─── Create form (minimal receive) ─────────────────────────────────────────

interface CreateFormProps {
  propertyId: UUID;
  propertyType?: PropertyType | null;
  onCreated: () => void;
}

function CreatePackageForm({ propertyId, propertyType, onCreated }: CreateFormProps) {
  const labels = useMemo(() => getPropertyLabels(propertyType), [propertyType]);
  const qc = useQueryClient();
  const [unitId, setUnitId] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [senderName, setSenderName] = useState('');
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [sizeCategory, setSizeCategory] = useState<PackageSize>('small');
  const [storageLocation, setStorageLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const unitsParams = useMemo(() => ({ is_active: true, limit: 200 }), []);
  const unitsQuery = useQuery({
    queryKey: qk.units.list(unitsParams),
    queryFn: ({ signal }) => api.units.list(unitsParams, { signal }),
  });
  const units = unitsQuery.data?.units ?? [];

  const create = useMutation({
    mutationFn: (body: CreatePackageBody) => api.packages.create(body),
    onSuccess: (r) => {
      setError(null);
      // Reset form.
      setUnitId('');
      setRecipientName('');
      setSenderName('');
      setCarrier('');
      setTrackingNumber('');
      setSizeCategory('small');
      setStorageLocation('');
      setNotes('');
      void invalidatePackage(qc, r.package.id);
      onCreated();
    },
    onError: (err) => setError(isV1ApiError(err) ? err.message : 'Ошибка создания'),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!unitId.trim()) {
      setError(`Выберите ${labels.unitLower}`);
      return;
    }
    create.mutate({
      property_id: propertyId,
      unit_id: unitId.trim(),
      recipient_name_snapshot: recipientName.trim() || null,
      sender_name: senderName.trim() || null,
      carrier: carrier.trim() || null,
      tracking_number: trackingNumber.trim() || null,
      size_category: sizeCategory,
      storage_location: storageLocation.trim() || null,
      notes: notes.trim() || null,
    });
  }

  return (
    <div data-testid="package-create-panel">
      <Card title="Принять посылку" subtitle="После приёма резидент получит уведомление">
      <form data-testid="package-create-form" onSubmit={onSubmit}>
        <Stack>
          <Inline>
            <Field
              id="pkg-unit"
              label={labels.unitField}
              hint={unitsQuery.isLoading ? 'Загружаем список помещений…' : undefined}
            >
              <Select
                id="pkg-unit"
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
                required
                disabled={unitsQuery.isLoading || unitsQuery.isError || units.length === 0}
              >
                <option value="">
                  {unitsQuery.isLoading
                    ? 'Загрузка…'
                    : units.length
                      ? `Выберите ${labels.unitLower}`
                      : `${labels.unitField} не найдена`}
                </option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>{formatUnitOption(unit, labels.unitField)}</option>
                ))}
              </Select>
            </Field>
            <Field id="pkg-recipient" label="Имя получателя (если на лист)">
              <Input
                id="pkg-recipient"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Например: Иванова А.И."
              />
            </Field>
          </Inline>

          <Inline>
            <Field id="pkg-sender" label="Отправитель">
              <Input
                id="pkg-sender"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                placeholder="Например: «Озон»"
              />
            </Field>
            <Field id="pkg-carrier" label="Служба доставки">
              <Input
                id="pkg-carrier"
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                placeholder="Например: «СДЭК»"
              />
            </Field>
          </Inline>

          <Inline>
            <Field id="pkg-tracking" label="Трек-номер">
              <Input
                id="pkg-tracking"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
              />
            </Field>
            <Field id="pkg-size" label="Размер">
              <Select
                id="pkg-size"
                value={sizeCategory}
                onChange={(e) => setSizeCategory(e.target.value as PackageSize)}
              >
                {SIZES.map((s) => (
                  <option key={s} value={s}>{SIZE_LABELS[s]}</option>
                ))}
              </Select>
            </Field>
          </Inline>

          <Field id="pkg-storage" label="Место хранения (ячейка)">
            <Input
              id="pkg-storage"
              value={storageLocation}
              onChange={(e) => setStorageLocation(e.target.value)}
              placeholder="Например: «A-12»"
            />
          </Field>

          <Field id="pkg-notes" label="Примечания">
            <Textarea
              id="pkg-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </Field>

          {error ? <Alert tone="error">{error}</Alert> : null}
          {unitsQuery.isError ? (
            <Alert tone="error">
              Не удалось загрузить список помещений:{' '}
              {isV1ApiError(unitsQuery.error) ? unitsQuery.error.message : 'неизвестная ошибка'}
            </Alert>
          ) : null}

          <Inline>
            <Button
              type="submit"
              variant="primary"
              loading={create.isPending}
              disabled={create.isPending || unitsQuery.isLoading || unitsQuery.isError || units.length === 0}
            >
              Принять посылку
            </Button>
          </Inline>
        </Stack>
      </form>
      </Card>
    </div>
  );
}

function formatUnitOption(unit: Unit, unitLabel: string): string {
  const floor = typeof unit.floor === 'number' ? `, этаж ${unit.floor}` : '';
  return `${unitLabel} ${unit.unit_number}${floor}`;
}
