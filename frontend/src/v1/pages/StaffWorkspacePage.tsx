/**
 * StaffWorkspacePage — DH-26 daily operations workspace.
 *
 * The page consumes the DH-25 `/staff-workspace` API as the read model:
 * inbox, request detail, resident-visible updates, internal comments and SLA
 * events. Mutating quick actions reuse `/api/v1/requests/*` compatibility
 * endpoints through the v1 client because those routes own assignment,
 * first-response and status transitions today.
 */

import { useDeferredValue, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, isV1ApiError } from '../api';
import type {
  ListStaffWorkspaceInboxParams,
  StaffRequestPriority,
  StaffRequestStatus,
  StaffWorkspaceQueue,
  StaffWorkspaceRequest,
  StaffWorkspaceUpdate,
  UserMe,
} from '../api';
import {
  invalidateStaffWorkspaceRequest,
  isStaffRole,
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

const QUEUES: ReadonlyArray<StaffWorkspaceQueue> = [
  'active',
  'mine',
  'unassigned',
  'assigned',
  'overdue',
  'emergency',
  'all',
];

const QUEUE_LABELS: Record<StaffWorkspaceQueue, string> = {
  active: 'Активные',
  mine: 'Мои',
  unassigned: 'Без исполнителя',
  assigned: 'Назначенные',
  overdue: 'Просроченные',
  emergency: 'Аварийные',
  all: 'Все',
};

const STATUS_FILTERS: ReadonlyArray<StaffRequestStatus | 'all'> = [
  'all',
  'pending',
  'scheduled',
  'accepted',
  'approved',
  'arrived',
  'completed',
  'rejected',
  'cancelled',
  'expired',
];

const STATUS_LABELS: Record<StaffRequestStatus, string> = {
  pending: 'Ожидает',
  scheduled: 'Запланирована',
  accepted: 'В работе',
  approved: 'Одобрена',
  arrived: 'Прибыл',
  completed: 'Завершена',
  rejected: 'Отклонена',
  cancelled: 'Отменена',
  expired: 'Истекла',
};

const PRIORITY_FILTERS: ReadonlyArray<StaffRequestPriority | 'all'> = [
  'all',
  'normal',
  'high',
  'emergency',
  'low',
];

const PRIORITY_LABELS: Record<StaffRequestPriority, string> = {
  low: 'Низкий',
  normal: 'Обычный',
  high: 'Высокий',
  emergency: 'Аварийный',
};

const TERMINAL_STATUSES = new Set<StaffRequestStatus>([
  'completed',
  'cancelled',
  'rejected',
  'expired',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requestStatusTone(status: StaffRequestStatus) {
  if (status === 'completed' || status === 'approved') return 'success';
  if (status === 'rejected' || status === 'cancelled' || status === 'expired') return 'error';
  if (status === 'accepted' || status === 'scheduled') return 'warning';
  if (status === 'arrived') return 'info';
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

function formatType(type: StaffWorkspaceRequest['type']): string {
  const labels: Record<string, string> = {
    pass: 'Пропуск',
    tech: 'Техник',
    repair: 'Ремонт',
    cleaning: 'Клининг',
    concierge: 'Консьерж',
    complaint: 'Жалоба',
    suggestion: 'Предложение',
    car: 'Авто',
    move_in: 'Заезд',
    move_out: 'Выезд',
    service: 'Сервис',
    territory: 'Территория',
    emergency: 'Авария',
  };
  return labels[type] ?? type;
}

function formatTarget(request: StaffWorkspaceRequest): string {
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

function actionLabel(status: StaffRequestStatus): string {
  if (status === 'accepted') return 'Принята в работу';
  if (status === 'completed') return 'Завершена сотрудником';
  if (status === 'rejected') return 'Отклонена сотрудником';
  return `Статус изменён: ${formatStatus(status)}`;
}

function assigneeRoleFor(user: UserMe): string {
  if (user.role === 'platform_admin' || user.role === 'management_company_admin') {
    return 'property_admin';
  }
  return normalizeUserRole(user.role);
}

function canUseQuickActions(user: UserMe): boolean {
  const role = normalizeUserRole(user.role);
  return isStaffRole(user.role) || role === 'property_admin';
}

// ─── Page ───────────────────────────────────────────────────────────────────

export function StaffWorkspacePage() {
  const user = useV1Session();
  const [queue, setQueue] = useState<StaffWorkspaceQueue>('active');
  const [status, setStatus] = useState<StaffRequestStatus | 'all'>('all');
  const [priority, setPriority] = useState<StaffRequestPriority | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const deferredSearch = useDeferredValue(search.trim());
  const searchParam = deferredSearch.length >= 2 ? deferredSearch : undefined;

  const filters = useMemo<ListStaffWorkspaceInboxParams>(() => ({
    queue,
    status: status === 'all' ? undefined : status,
    priority: priority === 'all' ? undefined : priority,
    q: searchParam,
    limit: 30,
    offset: 0,
  }), [queue, status, priority, searchParam]);

  const query = useQuery({
    queryKey: qk.staffWorkspace.inbox(filters),
    queryFn: ({ signal }) => api.staffWorkspace.listInbox(filters, { signal }),
    staleTime: 15_000,
  });

  const requests = query.data?.requests ?? [];
  const selectedRequest = selectedId
    ? requests.find((request) => request.id === selectedId) ?? null
    : null;
  const activeRequest = selectedRequest ?? requests[0] ?? null;
  const activeId = activeRequest?.id ?? null;

  if (!canUseQuickActions(user)) {
    return (
      <div className={uiClasses.pageShell}>
        <Alert tone="error">
          Рабочее место доступно только сотрудникам и администраторам объекта.
        </Alert>
      </div>
    );
  }

  return (
    <div className={uiClasses.pageShell}>
      <header className={uiClasses.pageHeader}>
        <h1 className={uiClasses.pageTitle}>Рабочее место staff</h1>
        <p className={uiClasses.pageSubtitle}>
          {user.property_slug ? `${user.property_slug} · ` : ''}
          единая очередь заявок, SLA и внутренние заметки
        </p>
      </header>

      <Stack>
        <Toolbar>
          <Inline>
            <Field id="staff-queue" label="Очередь">
              <Select
                id="staff-queue"
                value={queue}
                onChange={(event) => setQueue(event.target.value as StaffWorkspaceQueue)}
              >
                {QUEUES.map((value) => (
                  <option key={value} value={value}>{QUEUE_LABELS[value]}</option>
                ))}
              </Select>
            </Field>
            <Field id="staff-status" label="Статус">
              <Select
                id="staff-status"
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
            <Field id="staff-priority" label="Приоритет">
              <Select
                id="staff-priority"
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
              id="staff-search"
              label="Поиск"
              hint={search.trim().length === 1 ? 'Введите минимум 2 символа' : undefined}
            >
              <Input
                id="staff-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ФИО, телефон, авто"
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
          <section className={uiClasses.staffWorkspaceList} aria-label="Очередь заявок">
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
              <EmptyState>В выбранной очереди нет заявок.</EmptyState>
            ) : (
              <ul className={uiClasses.resourceList}>
                {requests.map((request) => (
                  <li key={request.id}>
                    <RequestListButton
                      request={request}
                      selected={request.id === activeId}
                      onSelect={() => setSelectedId(request.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Детали заявки">
            {activeId ? (
              <StaffRequestDetailPanel
                requestId={activeId}
                listRequest={activeRequest}
              />
            ) : (
              <EmptyState>Выберите заявку из очереди.</EmptyState>
            )}
          </section>
        </div>
      </Stack>
    </div>
  );
}

// ─── List row ───────────────────────────────────────────────────────────────

interface RequestListButtonProps {
  request: StaffWorkspaceRequest;
  selected: boolean;
  onSelect: () => void;
}

function RequestListButton({ request, selected, onSelect }: RequestListButtonProps) {
  const title = request.visitorName || request.resident.name || request.category || request.id;
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
        <Badge tone={priorityTone(request.priority)}>{formatPriority(request.priority)}</Badge>
      </span>
      <span className={uiClasses.resourceMeta}>
        <span>{formatType(request.type)}</span>
        <span>{formatStatus(request.status)}</span>
        <span>{request.assignedToName || 'без исполнителя'}</span>
      </span>
      <span className={uiClasses.resourceMeta}>
        <span>{request.category}</span>
        <span className={request.isOverdue ? uiClasses.staffTextDanger : undefined}>
          SLA: {due}
        </span>
      </span>
    </button>
  );
}

// ─── Detail ────────────────────────────────────────────────────────────────

interface StaffRequestDetailPanelProps {
  requestId: string;
  listRequest: StaffWorkspaceRequest | null;
}

function StaffRequestDetailPanel({ requestId, listRequest }: StaffRequestDetailPanelProps) {
  const user = useV1Session();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: qk.staffWorkspace.request(requestId),
    queryFn: ({ signal }) => api.staffWorkspace.getRequestDetail(requestId, { signal }),
    staleTime: 10_000,
  });

  const request = detail.data?.request ?? listRequest;

  const invalidate = () => invalidateStaffWorkspaceRequest(queryClient, requestId);

  const noteMutation = useMutation({
    mutationFn: (body: string) => api.staffWorkspace.createInternalComment(requestId, { body }),
    onSuccess: () => {
      setNote('');
      setActionError(null);
      setActionMessage('Заметка добавлена');
      void invalidate();
    },
    onError: (error) => {
      setActionMessage(null);
      setActionError(isV1ApiError(error) ? error.message : 'Не удалось добавить заметку');
    },
  });

  const assignMutation = useMutation({
    mutationFn: () =>
      api.staffWorkspace.assignRequest(requestId, {
        assigneeUid: user.uid,
        assigneeName: user.name || user.uid,
        assigneeRole: assigneeRoleFor(user),
      }),
    onSuccess: () => {
      setActionError(null);
      setActionMessage('Заявка назначена на вас');
      void invalidate();
    },
    onError: (error) => {
      setActionMessage(null);
      setActionError(isV1ApiError(error) ? error.message : 'Не удалось назначить заявку');
    },
  });

  const firstResponseMutation = useMutation({
    mutationFn: () => api.staffWorkspace.markFirstResponse(requestId),
    onSuccess: () => {
      setActionError(null);
      setActionMessage('Первый ответ зафиксирован');
      void invalidate();
    },
    onError: (error) => {
      setActionMessage(null);
      setActionError(isV1ApiError(error) ? error.message : 'Не удалось зафиксировать первый ответ');
    },
  });

  const statusMutation = useMutation({
    mutationFn: (nextStatus: StaffRequestStatus) => {
      if (!request) throw new Error('Request is not loaded');
      return api.staffWorkspace.updateStatus(requestId, {
        status: nextStatus,
        expectedCurrentStatus: request.status,
        historyLabel: actionLabel(nextStatus),
      });
    },
    onSuccess: (_, nextStatus) => {
      setActionError(null);
      setActionMessage(actionLabel(nextStatus));
      void invalidate();
    },
    onError: (error) => {
      setActionMessage(null);
      setActionError(isV1ApiError(error) ? error.message : 'Не удалось изменить статус');
    },
  });

  const submitNote = (event: FormEvent) => {
    event.preventDefault();
    const body = note.trim();
    if (!body) {
      setActionMessage(null);
      setActionError('Введите текст внутренней заметки');
      return;
    }
    noteMutation.mutate(body);
  };

  if (detail.isLoading && !request) {
    return (
      <Card>
        <Inline><Spinner /><span className={uiClasses.textMuted}>Загрузка деталей…</span></Inline>
      </Card>
    );
  }

  if (detail.isError && !request) {
    return (
      <Alert tone="error">
        Не удалось загрузить заявку: {isV1ApiError(detail.error) ? detail.error.message : 'ошибка сети'}
      </Alert>
    );
  }

  if (!request) return <EmptyState>Заявка не выбрана.</EmptyState>;

  const busy =
    noteMutation.isPending ||
    assignMutation.isPending ||
    firstResponseMutation.isPending ||
    statusMutation.isPending;

  const statusActions = getStatusActions(request.status);
  const showAssign = request.assignedToUid !== user.uid && !TERMINAL_STATUSES.has(request.status);
  const showFirstResponse = !request.firstResponseAt && !TERMINAL_STATUSES.has(request.status);

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
            <span>{request.visitorName || request.resident.name || request.category}</span>
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
          <Meta label="Первый ответ" value={formatDateTime(request.firstResponseAt)} />
          <Meta label="Срок SLA" value={formatDateTime(request.dueAt)} danger={request.isOverdue} />
        </dl>
        {request.comment ? (
          <p className={`${uiClasses.textBody} ${uiClasses.marginTop3}`}>{request.comment}</p>
        ) : null}
      </Card>

      <Card title="Быстрые действия">
        <Inline>
          {showAssign ? (
            <Button
              variant="secondary"
              onClick={() => assignMutation.mutate()}
              loading={assignMutation.isPending}
              disabled={busy}
            >
              Взять в работу
            </Button>
          ) : null}
          {showFirstResponse ? (
            <Button
              variant="secondary"
              onClick={() => firstResponseMutation.mutate()}
              loading={firstResponseMutation.isPending}
              disabled={busy}
            >
              Первый ответ
            </Button>
          ) : null}
          {statusActions.map((action) => (
            <Button
              key={action.status}
              variant={action.status === 'rejected' ? 'danger' : 'primary'}
              onClick={() => statusMutation.mutate(action.status)}
              loading={statusMutation.isPending}
              disabled={busy}
            >
              {action.label}
            </Button>
          ))}
          {!showAssign && !showFirstResponse && statusActions.length === 0 ? (
            <span className={uiClasses.textMuted}>Нет доступных быстрых действий.</span>
          ) : null}
        </Inline>
      </Card>

      <ResidentQuickViewCard request={request} />

      <Card title="Внутренние заметки">
        <form onSubmit={submitNote}>
          <Field id="staff-note" label="Новая заметка">
            <Textarea
              id="staff-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Комментарий видят только сотрудники"
              disabled={busy}
            />
          </Field>
          <Button type="submit" loading={noteMutation.isPending} disabled={busy}>
            Добавить заметку
          </Button>
        </form>
        <UpdateList
          updates={detail.data?.internalComments ?? []}
          empty="Внутренних заметок пока нет."
        />
      </Card>

      <Card title="Коммуникация с резидентом">
        <UpdateList
          updates={detail.data?.residentUpdates ?? []}
          empty="Резидентских обновлений пока нет."
        />
      </Card>

      <Card title="SLA события">
        {detail.data?.slaEvents.length ? (
          <ul className={uiClasses.timeline}>
            {detail.data.slaEvents.map((event) => (
              <li key={event.id} className={uiClasses.timelineItem}>
                <span className={uiClasses.timelineTime}>{formatDateTime(event.detectedAt)}</span>
                <span className={uiClasses.timelineBody}>
                  {event.eventType} · {event.severity}
                  {event.dueAt ? ` · срок ${formatDateTime(event.dueAt)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>Событий SLA пока нет.</EmptyState>
        )}
      </Card>
    </Stack>
  );
}

function getStatusActions(status: StaffRequestStatus): Array<{ status: StaffRequestStatus; label: string }> {
  if (TERMINAL_STATUSES.has(status)) return [];
  if (status === 'pending' || status === 'scheduled') {
    return [
      { status: 'accepted', label: 'Принять' },
      { status: 'rejected', label: 'Отклонить' },
    ];
  }
  if (status === 'approved' || status === 'accepted' || status === 'arrived') {
    return [{ status: 'completed', label: 'Завершить' }];
  }
  return [];
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
    <ul className={`${uiClasses.timeline} ${uiClasses.marginTop3}`}>
      {updates.map((update) => (
        <li key={update.id} className={uiClasses.timelineItem}>
          <span className={uiClasses.timelineTime}>{formatDateTime(update.createdAt)}</span>
          <span className={uiClasses.timelineBody}>
            <strong>{update.actorName || update.actorRole || 'staff'}</strong>
            <br />
            {update.body}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ResidentQuickViewCard({ request }: { request: StaffWorkspaceRequest }) {
  const residentId = request.resident.id ?? null;
  const enabled = Boolean(residentId && UUID_RE.test(residentId));
  const query = useQuery({
    queryKey: residentId ? qk.staffWorkspace.residentQuickView(residentId) : qk.staffWorkspace.residentQuickView('none'),
    enabled,
    queryFn: ({ signal }) => api.staffWorkspace.getResidentQuickView(residentId as string, { signal }),
    staleTime: 60_000,
  });

  if (!enabled) {
    return (
      <Card title="Резидент">
        <dl className={uiClasses.staffMetaGrid}>
          <Meta label="Имя" value={request.resident.name || request.createdByName || '—'} />
          <Meta label="Юнит" value={request.resident.apt || request.createdByApt || '—'} />
          <Meta label="UID" value={request.resident.uid || request.createdByUid || '—'} />
        </dl>
      </Card>
    );
  }

  if (query.isLoading) {
    return (
      <Card title="Резидент">
        <Inline><Spinner /><span className={uiClasses.textMuted}>Загрузка контекста…</span></Inline>
      </Card>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Card title="Резидент">
        <Alert tone="warning">
          Контекст резидента недоступен: {isV1ApiError(query.error) ? query.error.message : 'ошибка сети'}
        </Alert>
      </Card>
    );
  }

  const { resident, vehicles, requestCounts } = query.data;
  return (
    <Card title="Резидент">
      <dl className={uiClasses.staffMetaGrid}>
        <Meta label="Имя" value={resident.fullName} />
        <Meta label="Телефон" value={resident.phone || 'скрыт'} />
        <Meta label="Юнит" value={resident.unit.number} />
        <Meta label="Активные заявки" value={String(requestCounts.pending ?? 0)} />
      </dl>
      {vehicles.length ? (
        <p className={`${uiClasses.textMuted} ${uiClasses.marginTop3}`}>
          Авто: {vehicles.map((vehicle) => vehicle.plate_number).join(', ')}
        </p>
      ) : null}
    </Card>
  );
}
