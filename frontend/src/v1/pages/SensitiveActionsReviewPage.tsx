import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, isV1ApiError } from '../api';
import type {
  AuditReviewPriority,
  SensitiveActionAntiAbuseFinding,
  SensitiveActionAuditRow,
  SensitiveActionReportEvidence,
  SensitiveActionReportEvidenceStatus,
  SensitiveActionReportEvidenceType,
  SensitiveActionReviewDecision,
  SensitiveActionReviewSummary,
} from '../api';
import { useV1Session } from '../store';
import { getPropertyLabels } from '../lib/propertyLabels';
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
  uiClasses,
} from '../components/ui';
import type { BadgeTone } from '../components/ui';

const WINDOW_OPTIONS = [
  { value: 24, label: '24 часа' },
  { value: 72, label: '72 часа' },
  { value: 168, label: '7 дней' },
  { value: 720, label: '30 дней' },
] as const;

const FLAG_LABELS: Record<string, string> = {
  high_volume: 'Высокий объём',
  high_risk_category: 'Высокий риск',
  off_hours: 'Ночное окно',
  overdue_reviews: 'Просрочено',
};

const FALLBACK_EVIDENCE_TYPES: SensitiveActionReportEvidenceType[] = [
  'summary',
  'anti_abuse',
  'escalation',
  'attestation',
  'live_rollout',
];
const FALLBACK_EVIDENCE_STATUSES: SensitiveActionReportEvidenceStatus[] = ['generated', 'reviewed', 'failed'];
const REVIEW_DECISIONS: SensitiveActionReviewDecision[] = ['approved', 'needs_followup', 'dismissed'];

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}

function priorityTone(priority: string): BadgeTone {
  if (priority === 'urgent') return 'error';
  if (priority === 'high') return 'warning';
  if (priority === 'normal') return 'info';
  return 'neutral';
}

function statusTone(status: string, overdue = false): BadgeTone {
  if (status === 'approved' || status === 'dismissed') return 'success';
  if (status === 'needs_followup' || overdue) return 'warning';
  return 'neutral';
}

export function SensitiveActionsReviewPage() {
  const session = useV1Session();
  const labels = useMemo(() => getPropertyLabels(session.property_type), [session.property_type]);
  const propertyId = session.property_id ?? null;
  const [category, setCategory] = useState<string>('');
  const [windowHours, setWindowHours] = useState<number>(168);
  const [evidenceType, setEvidenceType] = useState<SensitiveActionReportEvidenceType>('summary');
  const [evidenceStatus, setEvidenceStatus] = useState<SensitiveActionReportEvidenceStatus>('generated');
  const [samplePercent, setSamplePercent] = useState('20');
  const [sampleDueHours, setSampleDueHours] = useState('48');
  const [escalateAfterHours, setEscalateAfterHours] = useState('24');
  const [targetReviewId, setTargetReviewId] = useState('');
  const [reviewerStaffId, setReviewerStaffId] = useState('');
  const [assignmentDueAt, setAssignmentDueAt] = useState('');
  const [assignmentPriority, setAssignmentPriority] = useState<AuditReviewPriority>('urgent');
  const [assignmentReason, setAssignmentReason] = useState('');
  const [reviewDecision, setReviewDecision] = useState<SensitiveActionReviewDecision>('approved');
  const [reviewComment, setReviewComment] = useState('');
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const commonParams = {
    property_id: propertyId ?? undefined,
    category: category || undefined,
  };

  const metaQuery = useQuery({
    queryKey: ['v1', 'sensitive-actions-meta'],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.auditReviews.meta({ signal }),
  });
  const summaryQuery = useQuery({
    queryKey: ['v1', 'sensitive-actions-summary', propertyId, category],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.auditReviews.summary(commonParams, { signal }),
  });
  const antiAbuseQuery = useQuery({
    queryKey: ['v1', 'sensitive-actions-anti-abuse', propertyId, category, windowHours],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.auditReviews.antiAbuse({
      ...commonParams,
      window_hours: windowHours,
      min_actions: 5,
      limit: 20,
    }, { signal }),
  });
  const pendingQuery = useQuery({
    queryKey: ['v1', 'sensitive-actions-pending', propertyId, category],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.auditReviews.list({
      ...commonParams,
      review_status: 'pending',
      limit: 20,
    }, { signal }),
  });
  const evidenceQuery = useQuery({
    queryKey: ['v1', 'sensitive-actions-evidence', propertyId, evidenceType, evidenceStatus],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.auditReviews.listReportEvidence({
      property_id: propertyId ?? undefined,
      report_type: evidenceType,
      status: evidenceStatus,
      limit: 10,
    }, { signal }),
  });

  if (!propertyId) {
    return (
      <div className={uiClasses.pageShell}>
        <header className={uiClasses.pageHeader}>
          <h1 className={uiClasses.pageTitle}>Sensitive action review</h1>
        </header>
        <Alert tone="warning">Администратор не привязан к объекту.</Alert>
      </div>
    );
  }

  const summary = summaryQuery.data?.summary ?? null;
  const analytics = antiAbuseQuery.data?.analytics ?? null;
  const pendingRows = pendingQuery.data?.actions ?? [];
  const categories = metaQuery.data?.categories ?? [];
  const evidenceRows = evidenceQuery.data?.evidence ?? [];
  const evidenceTypes = (metaQuery.data?.report_evidence_types as SensitiveActionReportEvidenceType[] | undefined)
    ?? FALLBACK_EVIDENCE_TYPES;
  const evidenceStatuses = (metaQuery.data?.report_evidence_statuses as SensitiveActionReportEvidenceStatus[] | undefined)
    ?? FALLBACK_EVIDENCE_STATUSES;
  const priorities = metaQuery.data?.priorities ?? ['low', 'normal', 'high', 'urgent'];
  const isLoading = summaryQuery.isLoading || antiAbuseQuery.isLoading || pendingQuery.isLoading || evidenceQuery.isLoading;
  const error = summaryQuery.error || antiAbuseQuery.error || pendingQuery.error || evidenceQuery.error || metaQuery.error;

  async function refetchReports() {
    await Promise.all([
      summaryQuery.refetch(),
      antiAbuseQuery.refetch(),
      pendingQuery.refetch(),
      evidenceQuery.refetch(),
    ]);
  }

  async function runAction<T>(key: string, action: () => Promise<T>, onSuccess: (result: T) => string) {
    setActionBusy(key);
    setActionError(null);
    setActionMessage(null);
    try {
      const result = await action();
      setActionMessage(onSuccess(result));
      await refetchReports();
    } catch (err) {
      setActionError(isV1ApiError(err) ? err.message : 'Не удалось выполнить действие');
    } finally {
      setActionBusy(null);
    }
  }

  function parseIntegerOption(value: string, fallback: number, min: number, max: number): number {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  async function recordEvidence() {
    await runAction(
      'evidence',
      () => api.auditReviews.recordReportEvidence({
        property_id: propertyId ?? undefined,
        report_type: evidenceType,
        status: evidenceStatus,
        period_from: null,
        period_to: null,
        summary: {
          category: category || 'all',
          window_hours: windowHours,
          total: summary?.totals.total ?? 0,
          overdue: summary?.totals.overdue ?? 0,
        },
      }),
      (res) => `Evidence записан: ${res.evidence.id}`,
    );
  }

  async function sampleReviews() {
    await runAction(
      'sample',
      () => api.auditReviews.sample({
        property_id: propertyId ?? undefined,
        category: category || undefined,
        window_hours: windowHours,
        sample_percent: parseIntegerOption(samplePercent, 20, 0, 100),
        due_hours: parseIntegerOption(sampleDueHours, 48, 1, 24 * 30),
        limit: 20,
      }),
      (res) => `Sampling создал review: ${res.sampled_count}`,
    );
  }

  async function escalateReviews() {
    await runAction(
      'escalate',
      () => api.auditReviews.escalate({
        property_id: propertyId ?? undefined,
        limit: 20,
        escalate_after_hours: parseIntegerOption(escalateAfterHours, 24, 1, 24 * 30),
      }),
      (res) => `Escalated: ${res.escalated_count}, hard: ${res.hard_escalated_count}`,
    );
  }

  async function assignReview(id = targetReviewId) {
    const trimmed = id.trim();
    if (!trimmed) {
      setActionError('Выберите sensitive action для назначения');
      return;
    }
    await runAction(
      `assign:${trimmed}`,
      () => api.auditReviews.assign(trimmed, {
        assigned_reviewer_staff_id: reviewerStaffId.trim() || null,
        due_at: assignmentDueAt.trim() || null,
        priority: assignmentPriority,
        reason: assignmentReason.trim() || null,
      }),
      (res) => `Назначено: ${res.review.id}`,
    );
  }

  async function reviewAction(id = targetReviewId) {
    const trimmed = id.trim();
    if (!trimmed) {
      setActionError('Выберите sensitive action для review');
      return;
    }
    await runAction(
      `review:${trimmed}`,
      () => api.auditReviews.review(trimmed, {
        decision: reviewDecision,
        comment: reviewComment.trim() || null,
      }),
      (res) => `Review сохранён: ${res.review.review_status}`,
    );
  }

  return (
    <div className={uiClasses.pageShell}>
      <header className={uiClasses.pageHeader}>
        <h1 className={uiClasses.pageTitle}>Sensitive action review</h1>
        <p className={uiClasses.pageSubtitle}>
          {labels.propertyKind}: отчёт по audit review, SLA и anti-abuse сигналам.
        </p>
      </header>

      <Stack>
        <Card>
          <Inline>
            <Field id="sensitive-category" label="Категория">
              <Select
                id="sensitive-category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="">Все категории</option>
                {categories.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </Select>
            </Field>
            <Field id="sensitive-window" label="Anti-abuse окно">
              <Select
                id="sensitive-window"
                value={windowHours}
                onChange={(event) => setWindowHours(Number(event.target.value))}
              >
                {WINDOW_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </Field>
          </Inline>
        </Card>

        {isLoading ? (
          <Card>
            <Inline><Spinner /><span className={uiClasses.textMuted}>Загрузка…</span></Inline>
          </Card>
        ) : null}

        {error ? (
          <Alert tone="error">
            Не удалось загрузить review report: {isV1ApiError(error) ? error.message : 'неизвестная ошибка'}
          </Alert>
        ) : null}
        {actionError ? <Alert tone="error">{actionError}</Alert> : null}
        {actionMessage ? <Alert tone="success">{actionMessage}</Alert> : null}

        {summary ? <SummarySection summary={summary} /> : null}
        {analytics ? <AntiAbuseSection rows={analytics.findings} /> : null}
        <AuditEvidenceActions
          evidenceRows={evidenceRows}
          evidenceType={evidenceType}
          evidenceStatus={evidenceStatus}
          evidenceTypes={evidenceTypes}
          evidenceStatuses={evidenceStatuses}
          samplePercent={samplePercent}
          sampleDueHours={sampleDueHours}
          escalateAfterHours={escalateAfterHours}
          actionBusy={actionBusy}
          onEvidenceTypeChange={setEvidenceType}
          onEvidenceStatusChange={setEvidenceStatus}
          onSamplePercentChange={setSamplePercent}
          onSampleDueHoursChange={setSampleDueHours}
          onEscalateAfterHoursChange={setEscalateAfterHours}
          onRecordEvidence={() => void recordEvidence()}
          onSample={() => void sampleReviews()}
          onEscalate={() => void escalateReviews()}
        />
        <ReviewActionPanel
          targetReviewId={targetReviewId}
          reviewerStaffId={reviewerStaffId}
          assignmentDueAt={assignmentDueAt}
          assignmentPriority={assignmentPriority}
          assignmentReason={assignmentReason}
          reviewDecision={reviewDecision}
          reviewComment={reviewComment}
          priorities={priorities}
          actionBusy={actionBusy}
          onTargetReviewIdChange={setTargetReviewId}
          onReviewerStaffIdChange={setReviewerStaffId}
          onAssignmentDueAtChange={setAssignmentDueAt}
          onAssignmentPriorityChange={setAssignmentPriority}
          onAssignmentReasonChange={setAssignmentReason}
          onReviewDecisionChange={setReviewDecision}
          onReviewCommentChange={setReviewComment}
          onAssign={() => void assignReview()}
          onReview={() => void reviewAction()}
        />
        <PendingReviewSection
          rows={pendingRows}
          actionBusy={actionBusy}
          onSelectReview={(id) => setTargetReviewId(id)}
          onAssignReview={(id) => {
            setTargetReviewId(id);
            void assignReview(id);
          }}
          onReviewAction={(id) => {
            setTargetReviewId(id);
            void reviewAction(id);
          }}
        />
      </Stack>
    </div>
  );
}

function SummarySection({ summary }: { summary: SensitiveActionReviewSummary }) {
  const pending = summary.totals.by_status.pending ?? 0;
  const urgent = summary.totals.by_priority.urgent ?? 0;
  const high = summary.totals.by_priority.high ?? 0;
  return (
    <Stack>
      <section className={uiClasses.formGrid} aria-label="Sensitive review KPIs">
        <KpiTile title="Всего" value={summary.totals.total} />
        <KpiTile
          title="Pending"
          value={pending}
          tone={pending > 0 ? 'warning' : 'success'}
        />
        <KpiTile
          title="Overdue"
          value={summary.totals.overdue}
          tone={summary.totals.overdue > 0 ? 'error' : 'success'}
        />
        <KpiTile
          title="Urgent / high"
          value={urgent + high}
          tone={urgent + high > 0 ? 'warning' : 'neutral'}
        />
      </section>

      <Card title="Статусы и приоритеты">
        {summary.rows.length ? (
          <ul className={uiClasses.resourceList}>
            {summary.rows.map((row) => (
              <li className={uiClasses.resourceRow} key={`${row.review_status}-${row.priority}`}>
                <div className={uiClasses.resourceRowMain}>
                  <p className={uiClasses.resourceTitle}>{row.review_status}</p>
                  <p className={uiClasses.resourceMeta}>
                    priority {row.priority} · overdue {formatNumber(row.overdue)}
                  </p>
                </div>
                <Badge tone={priorityTone(row.priority)}>{formatNumber(row.total)}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>Нет sensitive audit rows.</EmptyState>
        )}
      </Card>
    </Stack>
  );
}

function AntiAbuseSection({ rows }: { rows: SensitiveActionAntiAbuseFinding[] }) {
  return (
    <Card title="Anti-abuse findings">
      {rows.length ? (
        <ul className={uiClasses.resourceList}>
          {rows.map((row) => (
            <li className={uiClasses.resourceRow} key={`${row.actor_uid ?? 'unknown'}-${row.category}`}>
              <div className={uiClasses.resourceRowMain}>
                <p className={uiClasses.resourceTitle}>{row.actor_uid || 'unknown actor'}</p>
                <p className={uiClasses.resourceMeta}>
                  {row.actor_role || 'role unknown'} · {row.category} · risk {formatNumber(row.risk_score)}
                </p>
                <Inline>
                  {row.flags.map((flag) => (
                    <Badge key={flag} tone={flag === 'overdue_reviews' ? 'error' : 'warning'}>
                      {FLAG_LABELS[flag] ?? flag}
                    </Badge>
                  ))}
                </Inline>
              </div>
              <dl className={uiClasses.staffMetaGrid}>
                <Metric label="Actions" value={formatNumber(row.total_actions)} />
                <Metric label="High risk" value={formatNumber(row.high_risk_actions)} />
                <Metric label="Off-hours" value={formatNumber(row.off_hours_actions)} />
              </dl>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>Нет anti-abuse findings в выбранном окне.</EmptyState>
      )}
    </Card>
  );
}

function AuditEvidenceActions({
  evidenceRows,
  evidenceType,
  evidenceStatus,
  evidenceTypes,
  evidenceStatuses,
  samplePercent,
  sampleDueHours,
  escalateAfterHours,
  actionBusy,
  onEvidenceTypeChange,
  onEvidenceStatusChange,
  onSamplePercentChange,
  onSampleDueHoursChange,
  onEscalateAfterHoursChange,
  onRecordEvidence,
  onSample,
  onEscalate,
}: {
  evidenceRows: SensitiveActionReportEvidence[];
  evidenceType: SensitiveActionReportEvidenceType;
  evidenceStatus: SensitiveActionReportEvidenceStatus;
  evidenceTypes: SensitiveActionReportEvidenceType[];
  evidenceStatuses: SensitiveActionReportEvidenceStatus[];
  samplePercent: string;
  sampleDueHours: string;
  escalateAfterHours: string;
  actionBusy: string | null;
  onEvidenceTypeChange: (value: SensitiveActionReportEvidenceType) => void;
  onEvidenceStatusChange: (value: SensitiveActionReportEvidenceStatus) => void;
  onSamplePercentChange: (value: string) => void;
  onSampleDueHoursChange: (value: string) => void;
  onEscalateAfterHoursChange: (value: string) => void;
  onRecordEvidence: () => void;
  onSample: () => void;
  onEscalate: () => void;
}) {
  return (
    <Card title="Report evidence и sampling">
      <div className={uiClasses.formGrid}>
        <Field label="Evidence type">
          <Select value={evidenceType} onChange={(e) => onEvidenceTypeChange(e.target.value as SensitiveActionReportEvidenceType)}>
            {evidenceTypes.map((item) => <option key={item} value={item}>{item}</option>)}
          </Select>
        </Field>
        <Field label="Evidence status">
          <Select value={evidenceStatus} onChange={(e) => onEvidenceStatusChange(e.target.value as SensitiveActionReportEvidenceStatus)}>
            {evidenceStatuses.map((item) => <option key={item} value={item}>{item}</option>)}
          </Select>
        </Field>
        <Field label="Sample percent">
          <Input value={samplePercent} onChange={(e) => onSamplePercentChange(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Due hours">
          <Input value={sampleDueHours} onChange={(e) => onSampleDueHoursChange(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Escalate after hours">
          <Input value={escalateAfterHours} onChange={(e) => onEscalateAfterHoursChange(e.target.value)} inputMode="numeric" />
        </Field>
      </div>
      <Inline>
        <Button loading={actionBusy === 'evidence'} onClick={onRecordEvidence}>
          Записать evidence
        </Button>
        <Button variant="secondary" loading={actionBusy === 'sample'} onClick={onSample}>
          Запустить sampling
        </Button>
        <Button variant="secondary" loading={actionBusy === 'escalate'} onClick={onEscalate}>
          Эскалировать overdue
        </Button>
      </Inline>
      {evidenceRows.length ? (
        <ul className={`${uiClasses.resourceList} ${uiClasses.marginTop3}`}>
          {evidenceRows.map((row) => (
            <li key={row.id} className={uiClasses.resourceRow}>
              <div className={uiClasses.resourceRowMain}>
                <p className={uiClasses.resourceTitle}>{row.report_type}</p>
                <p className={uiClasses.resourceMeta}>
                  {row.status} · {row.created_at ? formatDateTime(row.created_at) : 'без даты'}
                </p>
              </div>
              <Badge tone={row.status === 'failed' ? 'error' : row.status === 'reviewed' ? 'success' : 'info'}>
                {Object.keys(row.summary ?? {}).length} fields
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState className={uiClasses.marginTop3}>Report evidence пока нет.</EmptyState>
      )}
    </Card>
  );
}

function ReviewActionPanel({
  targetReviewId,
  reviewerStaffId,
  assignmentDueAt,
  assignmentPriority,
  assignmentReason,
  reviewDecision,
  reviewComment,
  priorities,
  actionBusy,
  onTargetReviewIdChange,
  onReviewerStaffIdChange,
  onAssignmentDueAtChange,
  onAssignmentPriorityChange,
  onAssignmentReasonChange,
  onReviewDecisionChange,
  onReviewCommentChange,
  onAssign,
  onReview,
}: {
  targetReviewId: string;
  reviewerStaffId: string;
  assignmentDueAt: string;
  assignmentPriority: AuditReviewPriority;
  assignmentReason: string;
  reviewDecision: SensitiveActionReviewDecision;
  reviewComment: string;
  priorities: AuditReviewPriority[];
  actionBusy: string | null;
  onTargetReviewIdChange: (value: string) => void;
  onReviewerStaffIdChange: (value: string) => void;
  onAssignmentDueAtChange: (value: string) => void;
  onAssignmentPriorityChange: (value: AuditReviewPriority) => void;
  onAssignmentReasonChange: (value: string) => void;
  onReviewDecisionChange: (value: SensitiveActionReviewDecision) => void;
  onReviewCommentChange: (value: string) => void;
  onAssign: () => void;
  onReview: () => void;
}) {
  return (
    <Card title="Назначение и review">
      <div className={uiClasses.formGrid}>
        <Field label="Sensitive action ID">
          <Input value={targetReviewId} onChange={(e) => onTargetReviewIdChange(e.target.value)} placeholder="audit-log-uuid" />
        </Field>
        <Field label="Reviewer staff ID">
          <Input value={reviewerStaffId} onChange={(e) => onReviewerStaffIdChange(e.target.value)} placeholder="staff-uuid" />
        </Field>
        <Field label="Due at">
          <Input value={assignmentDueAt} onChange={(e) => onAssignmentDueAtChange(e.target.value)} placeholder="2026-05-18T09:00:00.000Z" />
        </Field>
        <Field label="Priority">
          <Select value={assignmentPriority} onChange={(e) => onAssignmentPriorityChange(e.target.value as AuditReviewPriority)}>
            {priorities.map((item) => <option key={item} value={item}>{item}</option>)}
          </Select>
        </Field>
        <Field label="Assignment reason">
          <Input value={assignmentReason} onChange={(e) => onAssignmentReasonChange(e.target.value)} placeholder="weekly override sample" />
        </Field>
        <Field label="Decision">
          <Select value={reviewDecision} onChange={(e) => onReviewDecisionChange(e.target.value as SensitiveActionReviewDecision)}>
            {REVIEW_DECISIONS.map((item) => <option key={item} value={item}>{item}</option>)}
          </Select>
        </Field>
        <Field label="Review comment">
          <Input value={reviewComment} onChange={(e) => onReviewCommentChange(e.target.value)} placeholder="checked" />
        </Field>
      </div>
      <Inline>
        <Button variant="secondary" loading={actionBusy?.startsWith('assign:') === true} onClick={onAssign}>
          Назначить review
        </Button>
        <Button loading={actionBusy?.startsWith('review:') === true} onClick={onReview}>
          Сохранить review
        </Button>
      </Inline>
    </Card>
  );
}

function PendingReviewSection({
  rows,
  actionBusy,
  onSelectReview,
  onAssignReview,
  onReviewAction,
}: {
  rows: SensitiveActionAuditRow[];
  actionBusy: string | null;
  onSelectReview: (id: string) => void;
  onAssignReview: (id: string) => void;
  onReviewAction: (id: string) => void;
}) {
  return (
    <Card title="Pending review queue">
      {rows.length ? (
        <ul className={uiClasses.resourceList}>
          {rows.map((row) => (
            <li className={uiClasses.resourceRow} key={row.id}>
              <div className={uiClasses.resourceRowMain}>
                <Inline>
                  <p className={uiClasses.resourceTitle}>{row.canonical_event_type}</p>
                  <Badge tone={statusTone(row.review.status, row.review.assignment.overdue)}>
                    {row.review.status}
                  </Badge>
                  <Badge tone={priorityTone(row.review.assignment.priority)}>
                    {row.review.assignment.priority}
                  </Badge>
                </Inline>
                <p className={uiClasses.resourceMeta}>
                  {row.category} · actor {row.actor_uid || 'unknown'} · {formatDateTime(row.created_at)}
                </p>
                <p className={uiClasses.textMuted}>
                  Due: {formatDateTime(row.review.assignment.due_at)} · Escalation: {row.review.assignment.escalation_status}
                </p>
              </div>
              <Badge tone={row.review.assignment.overdue ? 'error' : 'neutral'}>
                {row.review.assignment.overdue ? 'overdue' : 'open'}
              </Badge>
              <Inline>
                <Button variant="ghost" onClick={() => onSelectReview(row.id)}>
                  Выбрать
                </Button>
                <Button
                  variant="secondary"
                  loading={actionBusy === `assign:${row.id}`}
                  onClick={() => onAssignReview(row.id)}
                >
                  Назначить
                </Button>
                <Button
                  loading={actionBusy === `review:${row.id}`}
                  onClick={() => onReviewAction(row.id)}
                >
                  Review
                </Button>
              </Inline>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>Нет pending review items.</EmptyState>
      )}
    </Card>
  );
}

function KpiTile({
  title,
  value,
  tone = 'neutral',
}: {
  title: string;
  value: number;
  tone?: BadgeTone;
}) {
  return (
    <Card>
      <Stack>
        <Inline><Badge tone={tone}>{title}</Badge></Inline>
        <strong className={uiClasses.cardTitle}>{formatNumber(value)}</strong>
      </Stack>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
