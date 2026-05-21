/**
 * ContractorWorkspacePage — DH-30 restricted external contractor portal.
 *
 * Uses the DH-29 `/contractor-workspace` contract. Triage, assignment and
 * internal staff notes remain in staff/admin surfaces; this page only exposes
 * assigned external work and contractor lifecycle actions.
 */

import { useDeferredValue, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, isV1ApiError } from '../api';
import type {
  ContractorWorkspaceEvent,
  ContractorWorkspaceQueue,
  ContractorWorkspaceRequest,
  ListContractorWorkspaceQueueParams,
  StaffRequestPriority,
  StaffRequestStatus,
  StaffWorkspaceUpdate,
  UserMe,
} from '../api';
import {
  invalidateContractorWorkspaceRequest,
  normalizeUserRole,
  qk,
  useV1Session,
} from '../store';
import { OperationsNav } from '../components/OperationsNav';
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

const QUEUES: ReadonlyArray<ContractorWorkspaceQueue> = [
  'mine',
  'in_progress',
  'waiting',
  'resolved',
  'active',
  'all',
];

const QUEUE_LABELS: Record<ContractorWorkspaceQueue, string> = {
  active: 'Активные',
  mine: 'Мои работы',
  in_progress: 'В работе',
  waiting: 'Ожидание',
  waiting_assignment: 'Ожидают подрядчика',
  resolved: 'Сданные',
  all: 'Все',
};

const STATUS_FILTERS: ReadonlyArray<StaffRequestStatus | 'all'> = [
  'all',
  'assigned',
  'accepted',
  'in_progress',
  'waiting_parts',
  'waiting_contractor',
  'resolved',
];

const STATUS_LABELS: Record<StaffRequestStatus, string> = {
  new: 'Новая',
  triaged: 'Разобрана',
  assigned: 'Назначена',
  pending: 'Ожидает',
  scheduled: 'Запланирована',
  accepted: 'Принята',
  in_progress: 'Выполняется',
  waiting_resident: 'Ждём жителя',
  waiting_parts: 'Ждём материалы',
  waiting_contractor: 'Ждём подрядчика',
  resolved: 'Сдана',
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

function canUseContractorWorkspace(user: UserMe): boolean {
  const role = normalizeUserRole(user.role);
  return role === 'contractor'
    || role === 'admin'
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

function companyStatusTone(status: string | null | undefined) {
  if (status === 'active') return 'success';
  if (status === 'suspended') return 'warning';
  if (status === 'terminated') return 'error';
  return 'neutral';
}

function formatStatus(status: StaffRequestStatus): string {
  return STATUS_LABELS[status] ?? status;
}

function formatPriority(priority: StaffRequestPriority): string {
  return PRIORITY_LABELS[priority] ?? priority;
}

function canAssignContractorWork(user: UserMe): boolean {
  const role = normalizeUserRole(user.role);
  return role === 'concierge'
    || role === 'admin'
    || role === 'property_admin'
    || role === 'management_company_admin'
    || role === 'platform_admin';
}

function formatActionError(error: unknown, fallback: string): string {
  if (isV1ApiError(error)) {
    if (error.kind === 'conflict') {
      return 'Работа уже изменилась. Детали обновляются; проверьте актуальный статус и повторите действие.';
    }
    return error.message;
  }
  return fallback;
}

function formatType(type: ContractorWorkspaceRequest['type']): string {
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

function formatTarget(request: ContractorWorkspaceRequest): string {
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

export function ContractorWorkspacePage() {
  const user = useV1Session();
  const [queue, setQueue] = useState<ContractorWorkspaceQueue>('mine');
  const [status, setStatus] = useState<StaffRequestStatus | 'all'>('all');
  const [priority, setPriority] = useState<StaffRequestPriority | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assignRequestId, setAssignRequestId] = useState('');
  const [assignContractorUserId, setAssignContractorUserId] = useState('');
  const [assignNote, setAssignNote] = useState('');
  const [assignMessage, setAssignMessage] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

  const deferredSearch = useDeferredValue(search.trim());
  const searchParam = deferredSearch.length >= 2 ? deferredSearch : undefined;
  const canAccess = canUseContractorWorkspace(user);
  const canAssign = canAssignContractorWork(user);

  const filters = useMemo<ListContractorWorkspaceQueueParams>(() => ({
    queue,
    status: status === 'all' ? undefined : status,
    priority: priority === 'all' ? undefined : priority,
    q: searchParam,
    limit: 30,
    offset: 0,
  }), [queue, status, priority, searchParam]);

  const query = useQuery({
    queryKey: qk.contractorWorkspace.queue(filters),
    queryFn: ({ signal }) => api.contractorWorkspace.listQueue(filters, { signal }),
    enabled: canAccess,
    staleTime: 15_000,
  });

  const requests = query.data?.requests ?? [];
  const selectedRequest = selectedId
    ? requests.find((request) => request.id === selectedId) ?? null
    : null;
  const activeRequest = selectedRequest ?? requests[0] ?? null;
  const activeId = activeRequest?.id ?? null;
  const queryClient = useQueryClient();

  const assignMutation = useMutation({
    mutationFn: () => api.contractorWorkspace.assignRequest((assignRequestId.trim() || activeId || ''), {
      contractorUserId: assignContractorUserId.trim(),
      note: assignNote.trim() || undefined,
    }),
    onSuccess: (result) => {
      setAssignRequestId(result.request.id);
      setAssignNote('');
      setAssignError(null);
      setAssignMessage('Работа назначена подрядчику');
      void query.refetch();
      void queryClient.invalidateQueries({ queryKey: qk.contractorWorkspace.request(result.request.id) });
    },
    onError: (error) => {
      setAssignMessage(null);
      setAssignError(formatActionError(error, 'Не удалось назначить подрядчика'));
    },
  });

  const submitAssignment = (event: FormEvent) => {
    event.preventDefault();
    if (!(assignRequestId.trim() || activeId)) {
      setAssignMessage(null);
      setAssignError('Укажите request ID');
      return;
    }
    if (!assignContractorUserId.trim()) {
      setAssignMessage(null);
      setAssignError('Укажите contractor user ID');
      return;
    }
    assignMutation.mutate();
  };

  if (!canAccess) {
    return (
      <div className={uiClasses.pageShell}>
        <Alert tone="error">
          Портал подрядчика доступен только подрядчикам и администраторам объекта.
        </Alert>
      </div>
    );
  }

  return (
    <div className={uiClasses.pageShell}>
      <header className={uiClasses.pageHeader}>
        <h1 className={uiClasses.pageTitle}>Портал подрядчика</h1>
        <p className={uiClasses.pageSubtitle}>
          {user.property_slug ? `${user.property_slug} · ` : ''}
          назначенные работы, ожидание материалов и сдача результата
        </p>
        <OperationsNav />
      </header>

      <Stack>
        <Toolbar>
          <Inline>
            <Field id="contractor-queue" label="Очередь">
              <Select
                id="contractor-queue"
                value={queue}
                onChange={(event) => setQueue(event.target.value as ContractorWorkspaceQueue)}
              >
                {QUEUES.map((value) => (
                  <option key={value} value={value}>{QUEUE_LABELS[value]}</option>
                ))}
              </Select>
            </Field>
            <Field id="contractor-status" label="Статус">
              <Select
                id="contractor-status"
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
            <Field id="contractor-priority" label="Приоритет">
              <Select
                id="contractor-priority"
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
              id="contractor-search"
              label="Поиск"
              hint={search.trim().length === 1 ? 'Введите минимум 2 символа' : undefined}
            >
              <Input
                id="contractor-search"
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

        {canAssign ? (
          <Card title="Назначение подрядчика" subtitle="Admin/concierge action for DH-29 contractor work handoff.">
            <form onSubmit={submitAssignment} data-testid="contractor-assignment-form">
              <Stack>
                {assignError ? <Alert tone="error">{assignError}</Alert> : null}
                {assignMessage ? <Alert tone="success">{assignMessage}</Alert> : null}
                <Inline>
                  <Field id="contractor-assign-request-id" label="Request ID">
                    <Input
                      id="contractor-assign-request-id"
                      value={assignRequestId}
                      onChange={(event) => setAssignRequestId(event.currentTarget.value)}
                      placeholder={activeId ?? 'request-id'}
                      disabled={assignMutation.isPending}
                    />
                  </Field>
                  <Field id="contractor-assign-user-id" label="Contractor user ID">
                    <Input
                      id="contractor-assign-user-id"
                      value={assignContractorUserId}
                      onChange={(event) => setAssignContractorUserId(event.currentTarget.value)}
                      placeholder="contractor-user-uuid"
                      disabled={assignMutation.isPending}
                    />
                  </Field>
                  <Field id="contractor-assign-note" label="Комментарий">
                    <Input
                      id="contractor-assign-note"
                      value={assignNote}
                      onChange={(event) => setAssignNote(event.currentTarget.value)}
                      placeholder="Что передать подрядчику"
                      disabled={assignMutation.isPending}
                    />
                  </Field>
                  <Button type="submit" variant="secondary" loading={assignMutation.isPending}>
                    Назначить подрядчика
                  </Button>
                </Inline>
              </Stack>
            </form>
          </Card>
        ) : null}

        {query.isError ? (
          <Alert tone="error">
            Не удалось загрузить работы: {isV1ApiError(query.error) ? query.error.message : 'ошибка сети'}
          </Alert>
        ) : null}

        <div className={uiClasses.staffWorkspaceGrid}>
          <section className={uiClasses.staffWorkspaceList} aria-label="Очередь работ подрядчика">
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
              <EmptyState>В выбранной очереди нет работ.</EmptyState>
            ) : (
              <ul className={uiClasses.resourceList}>
                {requests.map((request) => (
                  <li key={request.id}>
                    <ContractorJobButton
                      request={request}
                      selected={request.id === activeId}
                      onSelect={() => setSelectedId(request.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Исполнение работы подрядчика">
            {activeId ? (
              <ContractorJobPanel requestId={activeId} listRequest={activeRequest} />
            ) : (
              <EmptyState>Выберите работу из очереди.</EmptyState>
            )}
          </section>
        </div>
      </Stack>
    </div>
  );
}

interface ContractorJobButtonProps {
  request: ContractorWorkspaceRequest;
  selected: boolean;
  onSelect: () => void;
}

function ContractorJobButton({ request, selected, onSelect }: ContractorJobButtonProps) {
  const title = request.resident.name || request.createdByName || request.category || request.id;
  const due = request.dueAt ? formatDateTime(request.dueAt) : 'без SLA';
  return (
    <button
      type="button"
      data-testid="contractor-job-row"
      data-request-id={request.id}
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
          Срок: {due}
        </span>
      </span>
    </button>
  );
}

interface ContractorJobPanelProps {
  requestId: string;
  listRequest: ContractorWorkspaceRequest | null;
}

function ContractorJobPanel({ requestId, listRequest }: ContractorJobPanelProps) {
  const queryClient = useQueryClient();
  const [waitingNote, setWaitingNote] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [attachmentIds, setAttachmentIds] = useState('');
  const [requiresFollowUp, setRequiresFollowUp] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: qk.contractorWorkspace.request(requestId),
    queryFn: ({ signal }) => api.contractorWorkspace.getRequestDetail(requestId, { signal }),
    staleTime: 10_000,
  });

  const request = detail.data?.request ?? listRequest;

  const invalidate = () => invalidateContractorWorkspaceRequest(queryClient, requestId);
  const handleActionError = (error: unknown, fallback: string) => {
    setActionMessage(null);
    if (isV1ApiError(error) && error.kind === 'conflict') void invalidate();
    setActionError(formatActionError(error, fallback));
  };

  const startMutation = useContractorActionMutation({
    action: () => api.contractorWorkspace.startRequest(requestId),
    success: 'Работа начата',
    setActionMessage,
    setActionError,
    invalidate,
  });

  const resumeMutation = useContractorActionMutation({
    action: () => api.contractorWorkspace.resumeRequest(requestId),
    success: 'Работа возобновлена',
    setActionMessage,
    setActionError,
    invalidate,
  });

  const waitingMutation = useMutation({
    mutationFn: () =>
      api.contractorWorkspace.setWaiting(requestId, {
        reason: 'parts',
        note: waitingNote.trim() || undefined,
      }),
    onSuccess: () => {
      setWaitingNote('');
      setActionError(null);
      setActionMessage('Переведено в ожидание материалов');
      void invalidate();
    },
    onError: (error) => {
      handleActionError(error, 'Не удалось изменить статус ожидания');
    },
  });

  const resolveMutation = useMutation({
    mutationFn: () => {
      const note = resolutionNote.trim();
      if (!note) throw new Error('resolutionNote is required');
      return api.contractorWorkspace.resolveRequest(requestId, {
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
      setActionMessage('Результат работ отправлен');
      void invalidate();
    },
    onError: (error) => {
      if (error instanceof Error && error.message === 'resolutionNote is required') {
        setActionMessage(null);
        setActionError('Введите результат работ');
        return;
      }
      handleActionError(error, 'Не удалось сдать работу');
    },
  });

  if (detail.isLoading && !request) {
    return (
      <Card>
        <Inline><Spinner /><span className={uiClasses.textMuted}>Загрузка работы…</span></Inline>
      </Card>
    );
  }

  if (detail.isError && !request) {
    return (
      <Alert tone="error">
        Не удалось загрузить работу: {isV1ApiError(detail.error) ? detail.error.message : 'ошибка сети'}
      </Alert>
    );
  }

  if (!request) return <EmptyState>Работа не выбрана.</EmptyState>;

  const busy =
    startMutation.isPending ||
    resumeMutation.isPending ||
    waitingMutation.isPending ||
    resolveMutation.isPending;

  const workflow = request.workflow;
  const contractor = request.contractor;

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
          <Meta label="Адрес" value={request.resident.apt || request.createdByApt || formatTarget(request)} />
          <Meta label="Подрядчик" value={contractor?.fullName || request.assignedToName || '—'} />
          <Meta label="Компания" value={contractor?.companyName || '—'} />
          <Meta label="Доступ до" value={formatDateTime(contractor?.accessExpiresAt)} />
          <Meta label="Начато" value={formatDateTime(request.startedAt)} />
          <Meta label="Срок" value={formatDateTime(request.dueAt)} danger={request.isOverdue} />
        </dl>
        {contractor?.companyStatus ? (
          <p className={`${uiClasses.textMuted} ${uiClasses.marginTop3}`}>
            Статус компании:{' '}
            <Badge tone={companyStatusTone(contractor.companyStatus)}>{contractor.companyStatus}</Badge>
          </p>
        ) : null}
        {request.comment ? (
          <p className={`${uiClasses.textBody} ${uiClasses.marginTop3}`}>{request.comment}</p>
        ) : null}
        {request.resolutionNote ? (
          <p className={`${uiClasses.textMuted} ${uiClasses.marginTop3}`}>
            Результат: {request.resolutionNote}
          </p>
        ) : null}
      </Card>

      <Card title="Действия подрядчика">
        <Inline>
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
          {!workflow.canStart && !workflow.canResume && !workflow.canWait && !workflow.canResolve ? (
            <span className={uiClasses.textMuted}>Для этого статуса нет доступных действий подрядчика.</span>
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
              <Field id="contractor-waiting-note" label="Комментарий к ожиданию">
                <Input
                  id="contractor-waiting-note"
                  value={waitingNote}
                  onChange={(event) => setWaitingNote(event.target.value)}
                  placeholder="Каких материалов или действий не хватает"
                  disabled={busy}
                />
              </Field>
              <Button type="submit" variant="secondary" loading={waitingMutation.isPending} disabled={busy}>
                Ждём материалы
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
              <Field id="contractor-resolution" label="Результат работ">
                <Textarea
                  id="contractor-resolution"
                  value={resolutionNote}
                  onChange={(event) => setResolutionNote(event.target.value)}
                  placeholder="Что сделано, что заменено, что проверено"
                  disabled={busy}
                />
              </Field>
              <Field id="contractor-attachment-ids" label="Фото результата">
                <Input
                  id="contractor-attachment-ids"
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
                Сдать работу
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

      <Card title="События подрядчика">
        {detail.data?.contractorEvents.length ? (
          <ul className={uiClasses.timeline}>
            {detail.data.contractorEvents.map((event) => (
              <li key={event.id} className={uiClasses.timelineItem}>
                <span className={uiClasses.timelineTime}>{formatDateTime(event.createdAt)}</span>
                <span className={uiClasses.timelineBody}>
                  {formatContractorEvent(event)}
                  {event.fromStatus ? ` · ${event.fromStatus} → ${event.toStatus}` : ` · ${event.toStatus}`}
                  <br />
                  <span className={uiClasses.textMuted}>{event.actorName || event.actorRole || 'contractor'}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>Событий исполнения пока нет.</EmptyState>
        )}
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

interface ContractorActionMutationOptions {
  action: () => Promise<unknown>;
  success: string;
  setActionMessage: (message: string | null) => void;
  setActionError: (message: string | null) => void;
  invalidate: () => Promise<void>;
}

function useContractorActionMutation({
  action,
  success,
  setActionMessage,
  setActionError,
  invalidate,
}: ContractorActionMutationOptions) {
  return useMutation({
    mutationFn: action,
    onSuccess: () => {
      setActionError(null);
      setActionMessage(success);
      void invalidate();
    },
    onError: (error) => {
      setActionMessage(null);
      if (isV1ApiError(error) && error.kind === 'conflict') void invalidate();
      setActionError(formatActionError(error, 'Не удалось выполнить действие'));
    },
  });
}

function formatContractorEvent(event: ContractorWorkspaceEvent): string {
  const labels: Record<string, string> = {
    assigned: 'Работа назначена',
    started: 'Работа начата',
    resumed: 'Работа возобновлена',
    waiting_parts: 'Ожидание материалов',
    resolved: 'Работа сдана',
  };
  return labels[event.eventType] ?? event.eventType;
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
            <strong>{update.actorName || update.actorRole || 'contractor'}</strong>
            <br />
            {update.body}
          </span>
        </li>
      ))}
    </ul>
  );
}
