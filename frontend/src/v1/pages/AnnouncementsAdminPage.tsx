/**
 * AnnouncementsAdminPage — staff/admin console для announcements_v2.
 *
 * Что умеет первая итерация:
 *   - Листать admin-объявления (`GET /admin/announcements?property_id=...`)
 *     с фильтром по status (draft / scheduled / active / expired / deleted / all).
 *   - Создавать draft через inline-форму (collapsible): title, body_md,
 *     category, audience_type, is_urgent, is_pinned, notify_channels.
 *     Полная audience/schedule-панель (building/entrance/unit_type, starts_at,
 *     expires_at) — отдельный iteration; сейчас только minimal-viable create.
 *   - Publish (любой staff для non-urgent; для urgent — только admin, backend
 *     вернёт 403 если не admin — мы показываем текст ошибки).
 *   - Unpublish / Delete — admin only (backend вернёт 403 иначе).
 *
 * Что НЕ делает (намеренно — вынесено в следующие iterations):
 *   - PATCH draft'а (editing in place).
 *   - Reach metrics (отдельная панель на /metrics-endpoint).
 *   - Rich text / markdown preview.
 *   - Autosave / optimistic updates.
 *
 * RBAC:
 *   Роут защищён RoleGate(CONCIERGE_ALLOW) в V1Router — сюда попадают только
 *   concierge / admin / staff.  Внутри компонент выбирает действия доступные
 *   ролям через isAdmin() хелпер; кнопки скрыты если действие недоступно.
 *
 * property_id:
 *   Берём из session.user.property_id.  Если там null (staff без привязки) —
 *   показываем guidance-алерт с инструкцией.
 */

import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, deriveAnnouncementStatus, isV1ApiError } from '../api';
import type {
  Announcement,
  AnnouncementAudienceType,
  AnnouncementCategory,
  AnnouncementChannel,
  AnnouncementStatus,
  CreateAnnouncementBody,
  UUID,
} from '../api';
import { useV1Session, qk, invalidateAnnouncement } from '../store';
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

const CATEGORIES: readonly AnnouncementCategory[] = [
  'general',
  'maintenance',
  'event',
  'emergency',
  'marketing',
];

const AUDIENCE_TYPES: readonly AnnouncementAudienceType[] = [
  'all',
  'building',
  'entrance',
  'unit_type',
];

const CHANNELS: readonly AnnouncementChannel[] = ['web_push', 'sms', 'telegram', 'email'];

const STATUS_FILTERS: ReadonlyArray<AnnouncementStatus | 'all'> = [
  'all',
  'draft',
  'scheduled',
  'active',
  'expired',
  'deleted',
];

const STATUS_LABELS: Record<AnnouncementStatus, { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'error' }> = {
  draft:     { label: 'черновик',     tone: 'neutral' },
  scheduled: { label: 'запланировано', tone: 'info' },
  active:    { label: 'активно',      tone: 'success' },
  expired:   { label: 'истекло',      tone: 'warning' },
  deleted:   { label: 'удалено',      tone: 'error' },
};

const CATEGORY_LABELS: Record<AnnouncementCategory, string> = {
  general:     'общее',
  maintenance: 'обслуживание',
  event:       'событие',
  emergency:   'экстренно',
  marketing:   'маркетинг',
};

const AUDIENCE_LABELS: Record<AnnouncementAudienceType, string> = {
  all:       'все',
  building:  'корпус',
  entrance:  'подъезд',
  unit_type: 'тип жильца',
};

// ─── Page ───────────────────────────────────────────────────────────────────

export function AnnouncementsAdminPage() {
  // useV1Session() returns UserMe directly (throws if not loaded yet — RoleGate
  // above this route ensures status === 'ready' before we render).
  const user = useV1Session();
  const propertyId = user.property_id ?? null;
  const isAdmin = user.role === 'admin';

  const [statusFilter, setStatusFilter] = useState<AnnouncementStatus | 'all'>('all');
  const [formOpen, setFormOpen] = useState(false);

  if (!propertyId) {
    return (
      <div className={uiClasses.pageShell}>
        <header className={uiClasses.pageHeader}>
          <h1 className={uiClasses.pageTitle}>Объявления</h1>
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
    <div className={uiClasses.pageShell}>
      <header className={uiClasses.pageHeader}>
        <h1 className={uiClasses.pageTitle}>Объявления</h1>
        <p className={uiClasses.pageSubtitle}>
          Создание, публикация и модерация объявлений объекта.
        </p>
      </header>

      <Stack>
        <Toolbar>
          <Inline>
            <label className={uiClasses.label} htmlFor="status-filter">Статус:</label>
            <Select
              id="status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as AnnouncementStatus | 'all')}
            >
              {STATUS_FILTERS.map((s) => (
                <option key={s} value={s}>
                  {s === 'all' ? 'все' : STATUS_LABELS[s].label}
                </option>
              ))}
            </Select>
          </Inline>
          <Button variant="primary" onClick={() => setFormOpen((v) => !v)}>
            {formOpen ? 'Скрыть форму' : '+ Новое объявление'}
          </Button>
        </Toolbar>

        {formOpen ? (
          <CreateAnnouncementForm
            propertyId={propertyId}
            onCreated={() => setFormOpen(false)}
          />
        ) : null}

        <AnnouncementsList
          propertyId={propertyId}
          status={statusFilter}
          isAdmin={isAdmin}
        />
      </Stack>
    </div>
  );
}

// ─── List ───────────────────────────────────────────────────────────────────

interface AnnouncementsListProps {
  propertyId: UUID;
  status: AnnouncementStatus | 'all';
  isAdmin: boolean;
}

function AnnouncementsList({ propertyId, status, isAdmin }: AnnouncementsListProps) {
  const params = useMemo(
    () => ({ property_id: propertyId, status: status === 'all' ? undefined : status }),
    [propertyId, status],
  );

  const query = useQuery({
    queryKey: qk.announcements.adminList(params),
    queryFn: ({ signal }) => api.announcements.listAdmin(params, { signal }),
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

  const items = query.data?.announcements ?? [];
  if (!items.length) {
    return <EmptyState>Нет объявлений с выбранным статусом.</EmptyState>;
  }

  return (
    <Stack>
      {items.map((a) => (
        <AnnouncementRow key={a.id} row={a} isAdmin={isAdmin} />
      ))}
    </Stack>
  );
}

// ─── Single announcement card with actions ─────────────────────────────────

interface AnnouncementRowProps {
  row: Announcement;
  isAdmin: boolean;
}

function AnnouncementRow({ row, isAdmin }: AnnouncementRowProps) {
  const qc = useQueryClient();
  const derivedStatus = deriveAnnouncementStatus(row);
  const meta = STATUS_LABELS[derivedStatus];

  const [actionError, setActionError] = useState<string | null>(null);
  const [fanOut, setFanOut] = useState<number | null>(null);

  const publish = useMutation({
    mutationFn: () => api.announcements.publish(row.id),
    onSuccess: (r) => {
      setActionError(null);
      setFanOut(r.outbox_fanout);
      void invalidateAnnouncement(qc, row.id);
    },
    onError: (err) => setActionError(isV1ApiError(err) ? err.message : 'Ошибка публикации'),
  });

  const unpublish = useMutation({
    mutationFn: () => api.announcements.unpublish(row.id),
    onSuccess: () => {
      setActionError(null);
      void invalidateAnnouncement(qc, row.id);
    },
    onError: (err) => setActionError(isV1ApiError(err) ? err.message : 'Ошибка отмены публикации'),
  });

  const remove = useMutation({
    mutationFn: () => api.announcements.remove(row.id),
    onSuccess: () => {
      setActionError(null);
      void invalidateAnnouncement(qc, row.id);
    },
    onError: (err) => setActionError(isV1ApiError(err) ? err.message : 'Ошибка удаления'),
  });

  const busy = publish.isPending || unpublish.isPending || remove.isPending;

  const audienceText =
    row.audience_type === 'unit_type' && row.audience_unit_type
      ? `${AUDIENCE_LABELS[row.audience_type]}: ${row.audience_unit_type}`
      : AUDIENCE_LABELS[row.audience_type];

  return (
    <Card
      title={
        <Inline>
          <span>{row.title}</span>
          {row.is_urgent ? <Badge tone="error">срочно</Badge> : null}
          {row.is_pinned ? <Badge tone="gold">закреп</Badge> : null}
        </Inline>
      }
      subtitle={
        <Inline>
          <Badge tone={meta.tone}>{meta.label}</Badge>
          <span className={uiClasses.textMuted}>{CATEGORY_LABELS[row.category]}</span>
          <span className={uiClasses.textMuted}>аудитория: {audienceText}</span>
          <span className={uiClasses.textMuted}>
            публикация: {row.published_at ? new Date(row.published_at).toLocaleString('ru-RU') : '—'}
          </span>
        </Inline>
      }
      actions={
        <Inline>
          {derivedStatus === 'draft' || derivedStatus === 'scheduled' ? (
            <Button
              variant="primary"
              loading={publish.isPending}
              disabled={busy}
              onClick={() => publish.mutate()}
            >
              Опубликовать
            </Button>
          ) : null}
          {isAdmin && (derivedStatus === 'active' || derivedStatus === 'scheduled' || derivedStatus === 'expired') ? (
            <Button
              variant="secondary"
              loading={unpublish.isPending}
              disabled={busy}
              onClick={() => unpublish.mutate()}
            >
              Снять
            </Button>
          ) : null}
          {isAdmin && derivedStatus !== 'deleted' ? (
            <Button
              variant="danger"
              loading={remove.isPending}
              disabled={busy}
              onClick={() => {
                if (confirm(`Удалить объявление «${row.title}»?`)) remove.mutate();
              }}
            >
              Удалить
            </Button>
          ) : null}
        </Inline>
      }
    >
      <p className={uiClasses.preWrap}>{row.body_md}</p>
      {fanOut !== null ? (
        <Alert tone="success">Опубликовано. Уведомлений в очереди: {fanOut}.</Alert>
      ) : null}
      {actionError ? <Alert tone="error">{actionError}</Alert> : null}
    </Card>
  );
}

// ─── Create form (minimal) ─────────────────────────────────────────────────

interface CreateFormProps {
  propertyId: UUID;
  onCreated: () => void;
}

function CreateAnnouncementForm({ propertyId, onCreated }: CreateFormProps) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [bodyMd, setBodyMd] = useState('');
  const [category, setCategory] = useState<AnnouncementCategory>('general');
  const [audienceType, setAudienceType] = useState<AnnouncementAudienceType>('all');
  const [isUrgent, setIsUrgent] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [channels, setChannels] = useState<AnnouncementChannel[]>(['web_push']);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: CreateAnnouncementBody) => api.announcements.create(body),
    onSuccess: (r) => {
      setError(null);
      // Reset form.
      setTitle('');
      setBodyMd('');
      setCategory('general');
      setAudienceType('all');
      setIsUrgent(false);
      setIsPinned(false);
      setChannels(['web_push']);
      // Invalidate lists — new draft должен появиться в admin-list.
      void invalidateAnnouncement(qc, r.announcement.id);
      onCreated();
    },
    onError: (err) => setError(isV1ApiError(err) ? err.message : 'Ошибка создания'),
  });

  function toggleChannel(ch: AnnouncementChannel) {
    setChannels((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch],
    );
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !bodyMd.trim()) {
      setError('Заголовок и текст обязательны');
      return;
    }
    if (!channels.length) {
      setError('Выберите хотя бы один канал уведомлений');
      return;
    }
    create.mutate({
      property_id: propertyId,
      title: title.trim(),
      body_md: bodyMd.trim(),
      is_urgent: isUrgent,
      is_pinned: isPinned,
      category,
      audience_type: audienceType,
      notify_channels: channels,
    });
  }

  return (
    <Card title="Новое объявление" subtitle="После создания — нажмите «Опубликовать» в списке">
      <form onSubmit={onSubmit}>
        <Stack>
          <Field id="ann-title" label="Заголовок">
            <Input
              id="ann-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              required
            />
          </Field>

          <Field id="ann-body" label="Текст (markdown)">
            <Textarea
              id="ann-body"
              value={bodyMd}
              onChange={(e) => setBodyMd(e.target.value)}
              rows={6}
              required
            />
          </Field>

          <Inline>
            <Field id="ann-category" label="Категория">
              <Select
                id="ann-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as AnnouncementCategory)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                ))}
              </Select>
            </Field>

            <Field id="ann-audience" label="Аудитория">
              <Select
                id="ann-audience"
                value={audienceType}
                onChange={(e) => setAudienceType(e.target.value as AnnouncementAudienceType)}
              >
                {AUDIENCE_TYPES.map((a) => (
                  <option key={a} value={a}>{AUDIENCE_LABELS[a]}</option>
                ))}
              </Select>
            </Field>
          </Inline>

          {audienceType !== 'all' ? (
            <Alert tone="info">
              Для аудиторий «корпус / подъезд / тип жильца» нужна расширенная форма
              (она планируется следующей итерацией). Сейчас создаётся объявление
              с audience_type=«{audienceType}», но без привязки — на бэкенде
              это вызовет 400. Выберите «все» для MVP.
            </Alert>
          ) : null}

          <Field label="Уведомления (каналы)">
            <Inline>
              {CHANNELS.map((ch) => (
                <label key={ch} className={uiClasses.label}>
                  <input
                    type="checkbox"
                    checked={channels.includes(ch)}
                    onChange={() => toggleChannel(ch)}
                  />{' '}
                  {ch}
                </label>
              ))}
            </Inline>
          </Field>

          <Inline>
            <label className={uiClasses.label}>
              <input
                type="checkbox"
                checked={isUrgent}
                onChange={(e) => setIsUrgent(e.target.checked)}
              />{' '}
              Срочное (только admin может публиковать)
            </label>
            <label className={uiClasses.label}>
              <input
                type="checkbox"
                checked={isPinned}
                onChange={(e) => setIsPinned(e.target.checked)}
              />{' '}
              Закрепить
            </label>
          </Inline>

          {error ? <Alert tone="error">{error}</Alert> : null}

          <Inline>
            <Button type="submit" variant="primary" loading={create.isPending} disabled={create.isPending}>
              Создать черновик
            </Button>
          </Inline>
        </Stack>
      </form>
    </Card>
  );
}
