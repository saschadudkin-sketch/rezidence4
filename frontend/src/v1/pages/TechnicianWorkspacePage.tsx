/**
 * TechnicianWorkspacePage — DH-28 technician execution workspace.
 *
 * Uses the DH-27 `/technician-workspace` contract for technician-scoped queue
 * and lifecycle actions. Staff/admin triage stays in StaffWorkspacePage; this
 * page is intentionally focused on field execution.
 */

import { useDeferredValue, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, isV1ApiError } from '../api';
import type {
  ListTechnicianWorkspaceQueueParams,
  StaffRequestPriority,
  StaffRequestStatus,
  StaffWorkspaceUpdate,
  TechnicianWorkspaceQueue,
  TechnicianWorkspaceRequest,
  UserMe,
} from '../api';
import {
  invalidateTechnicianWorkspaceRequest,
  normalizeUserRole,
  qk,
  useV1Session,
} from '../store';
import { formatDateTime } from '../components/formatters';
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

const QUEUES: ReadonlyArray<TechnicianWorkspaceQueue> = [
  'mine',
  'available',
  'in_progress',
  'waiting',
  'resolved',
  'active',
  'all',
];

const QUEUE_LABELS: Record<TechnicianWorkspaceQueue, string> = {
  active: 'Активные',
  mine: 'Мои задачи',
  available: 'Доступные',
  in_progress: 'В работе',
  waiting: 'Ожидание',
  resolved: 'Решённые',
  all: 'Все',
};

const STATUS_FILTERS: ReadonlyArray<StaffRequestStatus | 'all'> = [
  'all',
  'accepted',
  'assigned',
  'in_progress',
  'waiting_resident',
  'waiting_parts',
  'resolved',
  'pending',
  'scheduled',
];

const STATUS_LABELS: Record<StaffRequestStatus, string> = {
  new: 'Новая',
  triaged: 'Разобрана',
  assigned: 'Назначена',
  pending: 'Ожидает',
  scheduled: 'Запланирована',
  accepted: 'В работе',
  in_progress: 'Выполняется',
  waiting_resident: 'Ждём жителя',
  waiting_parts: 'Ждём материалы',
  waiting_contractor: 'Ждём подрядчика',
  resolved: 'Решена',
  approved: 'Одобрена',
  arrived: 'Прибыл',
  completed: 'Завершена',
  rejected: 'Отклонена',
  cancelled: 'Отменена',
  expired: 'Истекла',
};

const PRIORITY_FILTERS: ReadonlyArray<StaffRequestPriority | 'all'> = [
  'all',
  'emergency',
  'high',
  'normal',
  'low',
];

const PRIORITY_LABELS: Record<StaffRequestPriority, string> = {
  low: 'Низкий',
  normal: 'Обычный',
  high: 'Высокий',
  emergency: 'Аварийный',
};

function canUseTechnicianWorkspace(user: UserMe): boolean {
  const role = normalizeUserRole(user.role);
  return role === 'technician'
    || role === 'property_admin'
    || role === 'management_company_admin'
    || role === 'platform_admin';
}

function requestStatusTone(status: StaffRequestStatus) {
  if (status === 'resolved' || status === 'completed' || status === 'approved') return 'success';
  if (status === 'rejected' || status === 'cancelled' || status === 'expired') return 'error';
  if (status === 'in_progress' || status === 'accepted' || status === 'assigned') return 'warning';
  if (status === 'waiting_resident' || status === 'waiting_parts' || status === 'waiting_contractor') return 'info';
  return 'neutral';
}

function priorityTone(priority: StaffRequestPriority) {
  if (priority === 'emergency') return 'error';
  if (priority === 'high') return 'warning';
  if (priority === 'low') return 'neutral';
  return 'info';
}

function formatStatus(status: StaffRequestStatus): string {
  return STATUS_LABELS[status] ?? status;
}

function formatPriority(priority: StaffRequestPriority): string {
  return PRIORITY_LABELS[priority] ?? priority;
}

function formatType(type: TechnicianWorkspaceRequest['type']): string {
  const labels: Record<string, string> = {
    tech: 'Техник',
    repair: 'Ремонт',
    cleaning: 'Клининг',
    service: 'Сервис',
    territory: 'Территория',
    emergency: 'Авария',
    pass: 'Пропуск',
    car: 'Авто',
  };
  return labels[type] ?? type;
}

function formatTarget(request: TechnicianWorkspaceRequest): string {
  if (!request.targetType && !request.targetId) return '—';
  const labels: Record<string, string> = {
    unit: 'Юнит',
    home: 'Дом',
    access_zone: 'Зона',
    access_point: 'Точка доступа',
    common_territory: 'Общая территория',
    road: 'Дорога',
    service_area: 'Сервисная зона',
  };
  const type = request.targetType ? labels[request.targetType] ?? request.targetType : 'Цель';
  return request.targetId ? `${type}: ${request.targetId.slice(0, 8)}` : type;
}

function splitAttachmentIds(value: string): string[] {
  return value
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function TechnicianWorkspacePage() {
  const user = useV1Session();
  const [queue, setQueue] = useState<TechnicianWorkspaceQueue>('mine');
  const [status, setStatus] = useState<StaffRequestStatus | 'all'>('all');
  const [priority, setPriority] = useState<StaffRequestPriority | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const deferredSearch = useDeferredValue(search.trim());
  const searchParam = deferredSearch.length >= 2 ? deferredSearch : undefined;
  const canAccess = canUseTechnicianWorkspace(user);

  const filters = useMemo<ListTechnicianWorkspaceQueueParams>(() => ({
    queue,
    status: status === 'all' ? undefined : status,
    priority: priority === 'all' ? undefined : priority,
    q: searchParam,
    limit: 30,
    offset: 0,
  }), [queue, status, priority, searchParam]);

  const query = useQuery({
    queryKey: qk.technicianWorkspace.queue(filters),
    queryFn: ({ signal }) => api.technicianWorkspace.listQueue(filters, { signal }),
    enabled: canAccess,
    staleTime: 15_000,
  });

  const requests = query.data?.requests ?? [];
  const selectedRequest = selectedId
    ? requests.find((request) => request.id === selectedId) ?? null
    : null;
  const activeRequest = selectedRequest ?? requests[0] ?? null;
  const activeId = activeRequest?.id ?? null;

  if (!canAccess) {
    return (
      <div className={uiClasses.pageShell}>
        <Alert tone="error">
          Рабочее место техника доступно только техникам и администраторам объекта.
        </Alert>
      </div>
    );
  }

  return (
    <div className={uiClasses.pageShell}>
      <header className={uiClasses.pageHeader}>
        <h1 className={uiClasses.pageTitle}>Рабочее место техника</h1>
        <p className={uiClasses.pageSubtitle}>
          {user.property_slug ? `${user.property_slug} · ` : ''}
          назначенные задачи, ожидания, результат работ и SLA
        </p>
      </header>

      <Stack>
        <Toolbar>
          <Inline>
            <Field id="technician-queue" label="Очередь">
              <Select
                id="technician-queue"
                value={queue}
                onChange={(event) => setQueue(event.target.value as TechnicianWorkspaceQueue)}
              >
                {QUEUES.map((value) => (
                  <option key={value} value={value}>{QUEUE_LABELS[value]}</option>
                ))}
              </Select>
            </Field>
            <Field id="technician-status" label="Статус">
              <Select
                id="technician-status"
                value={status}
                onChange={(event) => setStatus(event.target.value as StaffRequestStatus | 'all')}
              >
                {STATUS_FILTERS.map((value) => (
                  <option key={value} value={value}>
                    {value === 'all' ? 'Все' : STATUS_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="technician-priority" label="Приоритет">
              <Select
                id="technician-priority"
                value={priority}
                onChange={(event) => setPriority(event.target.value as StaffRequestPriority | 'all')}
              >
                {PRIORITY_FILTERS.map((value) => (
                  <option key={value} value={value}>
                    {value === 'all' ? 'Все' : PRIORITY_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              id="technician-search"
              label="Поиск"
              hint={search.trim().length === 1 ? 'Введите минимум 2 символа' : undefined}
            >
              <Input
                id="technician-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Житель, адрес, категория"
              />
            </Field>
          </Inline>
          <Button variant="ghost" onClick={() => void query.refetch()} disabled={query.isFetching}>
            Обновить
          </Button>
        </Toolbar>

        {query.isError ? (
          <Alert tone="error">
            Не удалось загрузить очередь: {isV1ApiError(query.error) ? query.error.message : 'ошибка сети'}
          </Alert>
        ) : null}

        <div className={uiClasses.staffWorkspaceGrid}>
          <section className={uiClasses.staffWorkspaceList} aria-label="Очередь задач техника">
            <Inline>
              <Badge tone="neutral">{query.data?.total ?? requests.length}</Badge>
              <span className={uiClasses.textMuted}>{QUEUE_LABELS[queue]}</span>
              {query.isFetching ? <Spinner /> : null}
            </Inline>

            {query.isLoading ? (
              <Card>
                <Inline><Spinner /><span className={uiClasses.textMuted}>Загрузка…</span></Inline>
              </Card>
            ) : requests.length === 0 ? (
              <EmptyState>В выбранной очереди нет задач.</EmptyState>
            ) : (
              <ul className={uiClasses.resourceList}>
                {requests.map((request) => (
                  <li key={request.id}>
                    <TechnicianTaskButton
                      request={request}
                      selected={request.id === activeId}
                      onSelect={() => setSelectedId(request.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Исполнение задачи">
            {activeId ? (
              <TechnicianTaskPanel requestId={activeId} listRequest={activeRequest} />
            ) : (
              <EmptyState>Выберите задачу из очереди.</EmptyState>
            )}
          </section>
        </div>
      </Stack>
    </div>
  );
}

interface TechnicianTaskButtonProps {
  request: TechnicianWorkspaceRequest;
  selected: boolean;
  onSelect: () => void;
}

function TechnicianTaskButton({ request, selected, onSelect }: TechnicianTaskButtonProps) {
  const title = request.resident.name || request.createdByName || request.category || request.id;
  const due = request.dueAt ? formatDateTime(request.dueAt) : 'без SLA';
  return (
    <button
      type="button"
      className={`${uiClasses.staffRequestButton} ${selected ? uiClasses.staffRequestButtonActive : ''}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className={uiClasses.staffRequestButtonTop}>
        <span className={uiClasses.resourceTitle}>{title}</span>
        <Badge tone={requestStatusTone(request.status)}>{formatStatus(request.status)}</Badge>
      </span>
      <span className={uiClasses.resourceMeta}>
        <span>{formatType(request.type)}</span>
        <span>{request.category}</span>
        <span>{request.resident.apt || request.createdByApt || formatTarget(request)}</span>
      </span>
      <span className={uiClasses.resourceMeta}>
        <Badge tone={priorityTone(request.priority)}>{formatPriority(request.priority)}</Badge>
        <span className={request.isOverdue ? uiClasses.staffTextDanger : undefined}>
          SLA: {due}
        </span>
      </span>
    </button>
  );
}

interface TechnicianTaskPanelProps {
  requestId: string;
  listRequest: TechnicianWorkspaceRequest | null;
}

function TechnicianTaskPanel({ requestId, listRequest }: TechnicianTaskPanelProps) {
  const queryClient = useQueryClient();
  const [waitingReason, setWaitingReason] = useState<'resident' | 'parts'>('parts');
  const [waitingNote, setWaitingNote] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [attachmentIds, setAttachmentIds] = useState('');
  const [requiresFollowUp, setRequiresFollowUp] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: qk.technicianWorkspace.request(requestId),
    queryFn: ({ signal }) => api.technicianWorkspace.getRequestDetail(requestId, { signal }),
    staleTime: 10_000,
  });

  const request = detail.data?.request ?? listRequest;

  const invalidate = () => invalidateTechnicianWorkspaceRequest(queryClient, requestId);

  const claimMutation = useTechnicianActionMutation({
    action: () => api.technicianWorkspace.claimRequest(requestId),
    success: 'Задача взята в работу',
    setActionMessage,
    setActionError,
    invalidate,
  });

  const startMutation = useTechnicianActionMutation({
    action: () => api.technicianWorkspace.startRequest(requestId),
    success: 'Работа начата',
    setActionMessage,
    setActionError,
    invalidate,
  });

  const resumeMutation = useTechnicianActionMutation({
    action: () => api.technicianWorkspace.resumeRequest(requestId),
    success: 'Работа возобновлена',
    setActionMessage,
    setActionError,
    invalidate,
  });

  const waitingMutation = useMutation({
    mutationFn: () =>
      api.technicianWorkspace.setWaiting(requestId, {
        reason: waitingReason,
        note: waitingNote.trim() || undefined,
      }),
    onSuccess: () => {
      setWaitingNote('');
      setActionError(null);
      setActionMessage(waitingReason === 'resident' ? 'Переведено в ожидание жителя' : 'Переведено в ожидание материалов');
      void invalidate();
    },
    onError: (error) => {
      setActionMessage(null);
      setActionError(isV1ApiError(error) ? error.message : 'Не удалось изменить статус ожидания');
    },
  });

  const resolveMutation = useMutation({
    mutationFn: () => {
      const note = resolutionNote.trim();
      if (!note) throw new Error('resolutionNote is required');
      return api.technicianWorkspace.resolveRequest(requestId, {
        resolutionNote: note,
        requiresFollowUp,
        attachmentIds: splitAttachmentIds(attachmentIds),
      });
    },
    onSuccess: () => {
      setResolutionNote('');
      setAttachmentIds('');
      setRequiresFollowUp(false);
      setActionError(null);
      setActionMessage('Результат работ сохранён');
      void invalidate();
    },
    onError: (error) => {
      setActionMessage(null);
      setActionError(error instanceof Error && error.message === 'resolutionNote is required'
        ? 'Введите результат работ'
        : isV1ApiError(error) ? error.message : 'Не удалось завершить задачу');
    },
  });

  if (detail.isLoading && !request) {
    return (
      <Card>
        <Inline><Spinner /><span className={uiClasses.textMuted}>Загрузка задачи…</span></Inline>
      </Card>
    );
  }

  if (detail.isError && !request) {
    return (
      <Alert tone="error">
        Не удалось загрузить задачу: {isV1ApiError(detail.error) ? detail.error.message : 'ошибка сети'}
      </Alert>
    );
  }

  if (!request) return <EmptyState>Задача не выбрана.</EmptyState>;

  const busy =
    claimMutation.isPending ||
    startMutation.isPending ||
    resumeMutation.isPending ||
    waitingMutation.isPending ||
    resolveMutation.isPending;

  const workflow = request.workflow;

  return (
    <Stack>
      {actionError ? <Alert tone="error">{actionError}</Alert> : null}
      {actionMessage ? <Alert tone="success">{actionMessage}</Alert> : null}
      {detail.isError ? (
        <Alert tone="warning">
          Детали могли устареть: {isV1ApiError(detail.error) ? detail.error.message : 'ошибка сети'}
        </Alert>
      ) : null}

      <Card
        title={
          <Inline>
            <span>{request.resident.name || request.createdByName || request.category}</span>
            <Badge tone={requestStatusTone(request.status)}>{formatStatus(request.status)}</Badge>
            <Badge tone={priorityTone(request.priority)}>{formatPriority(request.priority)}</Badge>
          </Inline>
        }
        subtitle={`#${request.id.slice(0, 8)} · создана ${formatDateTime(request.createdAt)}`}
        actions={
          <Button variant="ghost" onClick={() => void detail.refetch()} disabled={detail.isFetching}>
            Обновить
          </Button>
        }
      >
        <dl className={uiClasses.staffMetaGrid}>
          <Meta label="Категория" value={request.category} />
          <Meta label="Тип" value={formatType(request.type)} />
          <Meta label="Цель" value={formatTarget(request)} />
          <Meta label="Исполнитель" value={request.assignedToName || 'не назначен'} />
          <Meta label="Начато" value={formatDateTime(request.startedAt)} />
          <Meta label="Срок SLA" value={formatDateTime(request.dueAt)} danger={request.isOverdue} />
        </dl>
        {request.comment ? (
          <p className={`${uiClasses.textBody} ${uiClasses.marginTop3}`}>{request.comment}</p>
        ) : null}
        {request.resolutionNote ? (
          <p className={`${uiClasses.textMuted} ${uiClasses.marginTop3}`}>
            Результат: {request.resolutionNote}
          </p>
        ) : null}
      </Card>

      <Card title="Действия техника">
        <Inline>
          {workflow.canClaim ? (
            <Button
              variant="secondary"
              onClick={() => claimMutation.mutate()}
              loading={claimMutation.isPending}
              disabled={busy}
            >
              Взять задачу
            </Button>
          ) : null}
          {workflow.canStart ? (
            <Button
              variant="primary"
              onClick={() => startMutation.mutate()}
              loading={startMutation.isPending}
              disabled={busy}
            >
              Начать
            </Button>
          ) : null}
          {workflow.canResume ? (
            <Button
              variant="primary"
              onClick={() => resumeMutation.mutate()}
              loading={resumeMutation.isPending}
              disabled={busy}
            >
              Возобновить
            </Button>
          ) : null}
          {!workflow.canClaim && !workflow.canStart && !workflow.canResume && !workflow.canWait && !workflow.canResolve ? (
            <span className={uiClasses.textMuted}>Для этого статуса нет доступных действий техника.</span>
          ) : null}
        </Inline>

        {workflow.canWait ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              waitingMutation.mutate();
            }}
            className={uiClasses.marginTop3}
          >
            <Inline>
              <Field id="technician-waiting-reason" label="Ожидание">
                <Select
                  id="technician-waiting-reason"
                  value={waitingReason}
                  onChange={(event) => setWaitingReason(event.target.value as 'resident' | 'parts')}
                  disabled={busy}
                >
                  <option value="parts">Материалы</option>
                  <option value="resident">Житель</option>
                </Select>
              </Field>
              <Field id="technician-waiting-note" label="Комментарий">
                <Input
                  id="technician-waiting-note"
                  value={waitingNote}
                  onChange={(event) => setWaitingNote(event.target.value)}
                  placeholder="Что нужно дождаться"
                  disabled={busy}
                />
              </Field>
              <Button type="submit" variant="secondary" loading={waitingMutation.isPending} disabled={busy}>
                Поставить на ожидание
              </Button>
            </Inline>
          </form>
        ) : null}

        {workflow.canResolve ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              resolveMutation.mutate();
            }}
            className={uiClasses.marginTop3}
          >
            <Stack>
              <Field id="technician-resolution" label="Результат работ">
                <Textarea
                  id="technician-resolution"
                  value={resolutionNote}
                  onChange={(event) => setResolutionNote(event.target.value)}
                  placeholder="Что сделано, что заменено, что проверено"
                  disabled={busy}
                />
              </Field>
              <Field id="technician-attachment-ids" label="Фото результата">
                <Input
                  id="technician-attachment-ids"
                  value={attachmentIds}
                  onChange={(event) => setAttachmentIds(event.target.value)}
                  placeholder="UUID вложений через пробел или запятую"
                  disabled={busy}
                />
              </Field>
              <label className={uiClasses.metaItem}>
                <input
                  type="checkbox"
                  checked={requiresFollowUp}
                  onChange={(event) => setRequiresFollowUp(event.target.checked)}
                  disabled={busy}
                />{' '}
                Нужен контрольный осмотр
              </label>
              <Button type="submit" variant="primary" loading={resolveMutation.isPending} disabled={busy}>
                Завершить задачу
              </Button>
            </Stack>
          </form>
        ) : null}
      </Card>

      <Card title="Вложения">
        {detail.data?.attachments.length ? (
          <ul className={uiClasses.resourceList}>
            {detail.data.attachments.map((attachment) => (
              <li key={attachment.id} className={uiClasses.resourceRow}>
                <div className={uiClasses.resourceRowMain}>
                  <p className={uiClasses.resourceTitle}>{attachment.fileKind || 'file'}</p>
                  <p className={uiClasses.resourceMeta}>
                    <a href={attachment.fileUrl} target="_blank" rel="noreferrer">{attachment.fileUrl}</a>
                  </p>
                  <p className={uiClasses.resourceMeta}>ID: {attachment.id}</p>
                </div>
                <Badge tone={attachment.visibility === 'internal' ? 'neutral' : 'info'}>
                  {attachment.visibility}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>Вложений пока нет.</EmptyState>
        )}
      </Card>

      <Card title="События техника">
        {detail.data?.technicianEvents.length ? (
          <ul className={uiClasses.timeline}>
            {detail.data.technicianEvents.map((event) => (
              <li key={event.id} className={uiClasses.timelineItem}>
                <span className={uiClasses.timelineTime}>{formatDateTime(event.createdAt)}</span>
                <span className={uiClasses.timelineBody}>
                  {formatTechnicianEvent(event.eventType)}
                  {event.fromStatus ? ` · ${event.fromStatus} → ${event.toStatus}` : ` · ${event.toStatus}`}
                  <br />
                  <span className={uiClasses.textMuted}>{event.actorName || event.actorRole || 'technician'}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>Событий исполнения пока нет.</EmptyState>
        )}
      </Card>

      <Card title="Внутренние заметки">
        <UpdateList
          updates={detail.data?.internalComments ?? []}
          empty="Внутренних заметок пока нет."
        />
      </Card>

      <Card title="Коммуникация с жителем">
        <UpdateList
          updates={detail.data?.residentUpdates ?? []}
          empty="Обновлений от жителя пока нет."
        />
      </Card>
    </Stack>
  );
}

interface TechnicianActionMutationOptions {
  action: () => Promise<unknown>;
  success: string;
  setActionMessage: (message: string | null) => void;
  setActionError: (message: string | null) => void;
  invalidate: () => Promise<void>;
}

function useTechnicianActionMutation({
  action,
  success,
  setActionMessage,
  setActionError,
  invalidate,
}: TechnicianActionMutationOptions) {
  return useMutation({
    mutationFn: action,
    onSuccess: () => {
      setActionError(null);
      setActionMessage(success);
      void invalidate();
    },
    onError: (error) => {
      setActionMessage(null);
      setActionError(isV1ApiError(error) ? error.message : 'Не удалось выполнить действие');
    },
  });
}

function formatTechnicianEvent(eventType: string): string {
  const labels: Record<string, string> = {
    claimed: 'Задача взята',
    started: 'Работа начата',
    resumed: 'Работа возобновлена',
    waiting_resident: 'Ожидание жителя',
    waiting_parts: 'Ожидание материалов',
    resolved: 'Работа выполнена',
  };
  return labels[eventType] ?? eventType;
}

function Meta({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={danger ? uiClasses.staffTextDanger : undefined}>{value || '—'}</dd>
    </div>
  );
}

function UpdateList({ updates, empty }: { updates: StaffWorkspaceUpdate[]; empty: string }) {
  if (!updates.length) return <EmptyState>{empty}</EmptyState>;
  return (
    <ul className={uiClasses.timeline}>
      {updates.map((update) => (
        <li key={update.id} className={uiClasses.timelineItem}>
          <span className={uiClasses.timelineTime}>{formatDateTime(update.createdAt)}</span>
          <span className={uiClasses.timelineBody}>
            <strong>{update.actorName || update.actorRole || 'technician'}</strong>
            <br />
            {update.body}
          </span>
        </li>
      ))}
    </ul>
  );
}
