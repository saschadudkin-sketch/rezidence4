/**
 * DocumentsAdminPage — staff/admin console для documents_v2.
 *
 * Что умеет первая итерация:
 *   - Листать документы объекта с фильтром по категории, опциями
 *     include_draft / include_deleted (только admin полезно).
 *   - Создавать документ через inline-форму (title, category, tag, body_md,
 *     file_url, is_public).  Опция publish_now сразу публикует.
 *   - Publish / Unpublish (admin).
 *   - Soft-delete (admin) с confirm.
 *   - История версий — отдельная карточка при раскрытии ряда (admin).
 *
 * Что НЕ делает (следующие iterations):
 *   - PATCH в inline-форме (надо layout'ом решить: modal или expand).
 *   - Rich-text / markdown-preview.
 *   - Upload файла напрямую — сейчас вручную вводим /uploads/... путь.
 *
 * RBAC:
 *   Роут защищён CONCIERGE_ALLOW.  Concierge может писать только в
 *   contacts/instructions — backend вернёт 400 если иначе; мы просто
 *   показываем error-message и не скрываем выбор категории (так проще
 *   объяснить пользователю что можно, а что нет).
 */

import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, deriveDocumentStatus, isV1ApiError } from '../api';
import type {
  CreateDocumentBody,
  DocumentCategory,
  DocumentStatus,
  UUID,
  V1Document,
} from '../api';
import { useV1Session, qk, invalidateDocument } from '../store';
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

const CATEGORIES: readonly DocumentCategory[] = [
  'rules',
  'contacts',
  'instructions',
  'contracts',
  'safety',
  'legal',
  'other',
];

const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  rules:        'правила',
  contacts:     'контакты УК',
  instructions: 'инструкции',
  contracts:    'договоры',
  safety:       'безопасность',
  legal:        'юридические',
  other:        'прочее',
};

const STATUS_LABELS: Record<DocumentStatus, { label: string; tone: 'neutral' | 'success' | 'error' }> = {
  draft:     { label: 'черновик',  tone: 'neutral' },
  published: { label: 'опубликован', tone: 'success' },
  deleted:   { label: 'удалён',     tone: 'error' },
};

// Категории доступные concierge — показываем hint, но не блокируем UI.
const CONCIERGE_ALLOWED: readonly DocumentCategory[] = ['contacts', 'instructions'];

// ─── Page ───────────────────────────────────────────────────────────────────

export function DocumentsAdminPage() {
  const user = useV1Session();
  const propertyId = user.property_id ?? null;
  const isAdmin = user.role === 'admin';
  const isConcierge = user.role === 'concierge';

  const [categoryFilter, setCategoryFilter] = useState<DocumentCategory | 'all'>('all');
  const [includeDraft, setIncludeDraft] = useState(true);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  if (!propertyId) {
    return (
      <div className={uiClasses.pageShell}>
        <header className={uiClasses.pageHeader}>
          <h1 className={uiClasses.pageTitle}>Документы</h1>
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
        <h1 className={uiClasses.pageTitle}>Документы</h1>
        <p className={uiClasses.pageSubtitle}>
          Справочник для резидентов: правила, контакты УК, инструкции.
        </p>
      </header>

      <Stack>
        <Toolbar>
          <Inline>
            <label className={uiClasses.label} htmlFor="doc-category">Категория:</label>
            <Select
              id="doc-category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as DocumentCategory | 'all')}
            >
              <option value="all">все</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </Select>
            <label className={uiClasses.label}>
              <input
                type="checkbox"
                checked={includeDraft}
                onChange={(e) => setIncludeDraft(e.target.checked)}
              />{' '}
              с черновиками
            </label>
            {isAdmin ? (
              <label className={uiClasses.label}>
                <input
                  type="checkbox"
                  checked={includeDeleted}
                  onChange={(e) => setIncludeDeleted(e.target.checked)}
                />{' '}
                с удалёнными
              </label>
            ) : null}
          </Inline>
          <Button variant="primary" onClick={() => setFormOpen((v) => !v)}>
            {formOpen ? 'Скрыть форму' : '+ Новый документ'}
          </Button>
        </Toolbar>

        {isConcierge ? (
          <Alert tone="info">
            Роль concierge может создавать и редактировать только в категориях
            «контакты УК» и «инструкции». Попытка выбрать другую категорию будет
            отклонена сервером.
          </Alert>
        ) : null}

        {formOpen ? (
          <CreateDocumentForm
            propertyId={propertyId}
            isConcierge={isConcierge}
            onCreated={() => setFormOpen(false)}
          />
        ) : null}

        <DocumentsList
          propertyId={propertyId}
          category={categoryFilter}
          includeDraft={includeDraft}
          includeDeleted={includeDeleted}
          isAdmin={isAdmin}
        />
      </Stack>
    </div>
  );
}

// ─── List ───────────────────────────────────────────────────────────────────

interface DocumentsListProps {
  propertyId: UUID;
  category: DocumentCategory | 'all';
  includeDraft: boolean;
  includeDeleted: boolean;
  isAdmin: boolean;
}

function DocumentsList({
  propertyId,
  category,
  includeDraft,
  includeDeleted,
  isAdmin,
}: DocumentsListProps) {
  const params = useMemo(
    () => ({
      property_id: propertyId,
      category: category === 'all' ? undefined : category,
      include_draft: includeDraft || undefined,
      include_deleted: includeDeleted || undefined,
    }),
    [propertyId, category, includeDraft, includeDeleted],
  );

  const query = useQuery({
    queryKey: qk.documents.list(params),
    queryFn: ({ signal }) => api.documents.list(params, { signal }),
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

  const items = query.data?.documents ?? [];
  if (!items.length) {
    return <EmptyState>Нет документов с выбранными фильтрами.</EmptyState>;
  }

  return (
    <Stack>
      {items.map((d) => (
        <DocumentRow key={d.id} row={d} isAdmin={isAdmin} />
      ))}
    </Stack>
  );
}

// ─── Single document card with actions ─────────────────────────────────────

interface DocumentRowProps {
  row: V1Document;
  isAdmin: boolean;
}

function DocumentRow({ row, isAdmin }: DocumentRowProps) {
  const qc = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const derivedStatus = deriveDocumentStatus(row);
  const meta = STATUS_LABELS[derivedStatus];

  const publish = useMutation({
    mutationFn: () => api.documents.publish(row.id),
    onSuccess: () => {
      setActionError(null);
      void invalidateDocument(qc, row.id);
    },
    onError: (err) => setActionError(isV1ApiError(err) ? err.message : 'Ошибка публикации'),
  });

  const unpublish = useMutation({
    mutationFn: () => api.documents.unpublish(row.id),
    onSuccess: () => {
      setActionError(null);
      void invalidateDocument(qc, row.id);
    },
    onError: (err) => setActionError(isV1ApiError(err) ? err.message : 'Ошибка отмены публикации'),
  });

  const remove = useMutation({
    mutationFn: () => api.documents.remove(row.id),
    onSuccess: () => {
      setActionError(null);
      void invalidateDocument(qc, row.id);
    },
    onError: (err) => setActionError(isV1ApiError(err) ? err.message : 'Ошибка удаления'),
  });

  const busy = publish.isPending || unpublish.isPending || remove.isPending;

  return (
    <Card
      title={
        <Inline>
          <span>{row.title}</span>
          {row.is_public ? <Badge tone="info">публичный</Badge> : null}
        </Inline>
      }
      subtitle={
        <Inline>
          <Badge tone={meta.tone}>{meta.label}</Badge>
          <span className={uiClasses.textMuted}>{CATEGORY_LABELS[row.category]}</span>
          {row.tag ? <span className={uiClasses.textMuted}>тег: {row.tag}</span> : null}
          <span className={uiClasses.textMuted}>
            публикация: {row.published_at ? new Date(row.published_at).toLocaleString('ru-RU') : '—'}
          </span>
          {row.file_url ? (
            <a href={row.file_url} target="_blank" rel="noreferrer" className={uiClasses.textMuted}>
              файл
            </a>
          ) : null}
        </Inline>
      }
      actions={
        <Inline>
          {derivedStatus === 'draft' ? (
            <Button
              variant="primary"
              loading={publish.isPending}
              disabled={busy}
              onClick={() => publish.mutate()}
            >
              Опубликовать
            </Button>
          ) : null}
          {isAdmin && derivedStatus === 'published' ? (
            <Button
              variant="secondary"
              loading={unpublish.isPending}
              disabled={busy}
              onClick={() => unpublish.mutate()}
            >
              Снять
            </Button>
          ) : null}
          {isAdmin ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setVersionsOpen((v) => !v)}
            >
              {versionsOpen ? 'Скрыть историю' : 'История'}
            </Button>
          ) : null}
          {isAdmin && derivedStatus !== 'deleted' ? (
            <Button
              variant="danger"
              loading={remove.isPending}
              disabled={busy}
              onClick={() => {
                if (confirm(`Удалить документ «${row.title}»?`)) remove.mutate();
              }}
            >
              Удалить
            </Button>
          ) : null}
        </Inline>
      }
    >
      <Stack>
        {row.body_md ? (
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{row.body_md}</p>
        ) : (
          <p className={uiClasses.textMuted} style={{ margin: 0 }}>
            Тело пустое — документ ссылается на файл: {row.file_url ?? '—'}
          </p>
        )}
        {publish.isSuccess && publish.data?.idempotent ? (
          <Alert tone="info">Уже был опубликован — идемпотентный ответ.</Alert>
        ) : null}
        {actionError ? <Alert tone="error">{actionError}</Alert> : null}
        {versionsOpen ? <DocumentVersionsCard documentId={row.id} /> : null}
      </Stack>
    </Card>
  );
}

// ─── Versions panel (lazy-loaded) ──────────────────────────────────────────

interface DocumentVersionsCardProps {
  documentId: UUID;
}

function DocumentVersionsCard({ documentId }: DocumentVersionsCardProps) {
  const query = useQuery({
    queryKey: qk.documents.versions(documentId),
    queryFn: ({ signal }) => api.documents.listVersions(documentId, { signal }),
  });

  if (query.isLoading) {
    return (
      <Card>
        <Inline><Spinner /><span className={uiClasses.textMuted}>Загрузка истории…</span></Inline>
      </Card>
    );
  }

  if (query.isError) {
    const msg = isV1ApiError(query.error) ? query.error.message : 'Неизвестная ошибка';
    return <Alert tone="error">Не удалось загрузить историю: {msg}</Alert>;
  }

  const versions = query.data?.versions ?? [];
  if (!versions.length) {
    return (
      <Card title="История изменений">
        <EmptyState>Изменений ещё не было.</EmptyState>
      </Card>
    );
  }

  return (
    <Card title={`История изменений (${versions.length})`}>
      <Stack>
        {versions.map((v) => (
          <Card key={v.id} elevated>
            <Stack>
              <Inline>
                <Badge tone="neutral">v{v.version}</Badge>
                <span>{v.title}</span>
                <span className={uiClasses.textMuted}>
                  {new Date(v.created_at).toLocaleString('ru-RU')}
                </span>
                <span className={uiClasses.textMuted}>
                  {CATEGORY_LABELS[v.category]}
                </span>
              </Inline>
              {v.reason ? (
                <Inline>
                  <span className={uiClasses.textMuted}>Причина:</span>
                  <span>{v.reason}</span>
                </Inline>
              ) : null}
            </Stack>
          </Card>
        ))}
      </Stack>
    </Card>
  );
}

// ─── Create form ───────────────────────────────────────────────────────────

interface CreateFormProps {
  propertyId: UUID;
  isConcierge: boolean;
  onCreated: () => void;
}

function CreateDocumentForm({ propertyId, isConcierge, onCreated }: CreateFormProps) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<DocumentCategory>(
    isConcierge ? 'contacts' : 'rules',
  );
  const [tag, setTag] = useState('');
  const [bodyMd, setBodyMd] = useState('');
  const [fileUrl, setFileUrl] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [publishNow, setPublishNow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: CreateDocumentBody) => api.documents.create(body),
    onSuccess: (r) => {
      setError(null);
      // Reset form.
      setTitle('');
      setCategory(isConcierge ? 'contacts' : 'rules');
      setTag('');
      setBodyMd('');
      setFileUrl('');
      setIsPublic(false);
      setPublishNow(false);
      void invalidateDocument(qc, r.document.id);
      onCreated();
    },
    onError: (err) => setError(isV1ApiError(err) ? err.message : 'Ошибка создания'),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Заголовок обязателен');
      return;
    }
    if (!bodyMd.trim() && !fileUrl.trim()) {
      setError('Нужен либо текст (markdown), либо ссылка на файл');
      return;
    }
    if (fileUrl.trim() && !fileUrl.trim().startsWith('/uploads/')) {
      setError('file_url должен начинаться с /uploads/');
      return;
    }
    if (isConcierge && !CONCIERGE_ALLOWED.includes(category)) {
      setError(
        `Для роли concierge доступны только категории: ${CONCIERGE_ALLOWED.join(', ')}`,
      );
      return;
    }
    create.mutate({
      property_id: propertyId,
      title: title.trim(),
      category,
      tag: tag.trim() || null,
      body_md: bodyMd.trim() || null,
      file_url: fileUrl.trim() || null,
      is_public: isPublic,
      publish_now: publishNow,
    });
  }

  return (
    <Card title="Новый документ" subtitle="Текст в markdown или ссылка на файл (/uploads/...)">
      <form onSubmit={onSubmit}>
        <Stack>
          <Field id="doc-title" label="Заголовок">
            <Input
              id="doc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              required
            />
          </Field>

          <Inline>
            <Field id="doc-category" label="Категория">
              <Select
                id="doc-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as DocumentCategory)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                ))}
              </Select>
            </Field>

            <Field id="doc-tag" label="Тег (опционально)">
              <Input
                id="doc-tag"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                placeholder="Например: «новосёлам»"
              />
            </Field>
          </Inline>

          <Field id="doc-body" label="Текст (markdown)">
            <Textarea
              id="doc-body"
              value={bodyMd}
              onChange={(e) => setBodyMd(e.target.value)}
              rows={8}
              placeholder="Можно оставить пустым, если прикреплён файл"
            />
          </Field>

          <Field id="doc-file" label="Ссылка на файл" hint="Должна начинаться с /uploads/">
            <Input
              id="doc-file"
              value={fileUrl}
              onChange={(e) => setFileUrl(e.target.value)}
              placeholder="/uploads/docs/example.pdf"
            />
          </Field>

          <Inline>
            <label className={uiClasses.label}>
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
              />{' '}
              Показывать на публичной странице объекта
            </label>
            <label className={uiClasses.label}>
              <input
                type="checkbox"
                checked={publishNow}
                onChange={(e) => setPublishNow(e.target.checked)}
              />{' '}
              Опубликовать сразу (без черновика)
            </label>
          </Inline>

          {error ? <Alert tone="error">{error}</Alert> : null}

          <Inline>
            <Button type="submit" variant="primary" loading={create.isPending} disabled={create.isPending}>
              {publishNow ? 'Создать и опубликовать' : 'Создать черновик'}
            </Button>
          </Inline>
        </Stack>
      </form>
    </Card>
  );
}
