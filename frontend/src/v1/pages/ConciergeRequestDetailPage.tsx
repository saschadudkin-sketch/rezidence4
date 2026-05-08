/**
 * ConciergeRequestDetailPage — concierge / admin view of a single
 * access-request with its full lifecycle: approvals → pass → visits →
 * incidents.
 *
 * Data dependencies (sequential, each only blocks its own region):
 *   1. accessRequests.getById(id)
 *      → { access_request, approvals, pass: PassSummary | null }
 *   2. If pass present: passes.getById(pass.id) → full Pass row
 *      (the detail endpoint returns a compact PassSummary; <PassCard>
 *      inside <AccessRequestLifecycle> needs revoked_reason / ids /
 *      subject fields that are only on the full Pass).
 *   3. If pass present: visits.list({ pass_id })
 *   4. incidents: list all property incidents, filter client-side to
 *      those with related_pass_id === pass.id.  The backend doesn't
 *      expose a pass_id filter on /access-incidents yet — documented
 *      limitation; tracked in ACCESS_SOURCE_OF_TRUTH.md under the
 *      incidents-spec follow-up.
 *
 * Concierge actions:
 *   - `new` or `pending_approval` status → approve / reject / escalate.
 *     Approve creates the pass; reject/escalate are terminal writes that
 *     invalidate the detail view.
 *   - All mutations trigger a full re-fetch rather than surgical splice —
 *     the backend is the source of truth for derived state (approvals
 *     gain rows, pass gets created, status flips).
 */

import { useCallback, useEffect, useState } from 'react';
import type {
  AccessApproval,
  AccessIncident,
  AccessRequest,
  Pass,
  UUID,
  VisitLog,
} from '../api/types';
import { api, isV1ApiError } from '../api';
import { AccessRequestCard } from '../components/AccessRequestCard';
import { AccessRequestLifecycle } from '../components/AccessRequestLifecycle';
import {
  Alert,
  Button,
  Card,
  Field,
  Inline,
  Input,
  Spinner,
  Stack,
  Textarea,
  uiClasses,
} from '../components/ui';
import { useV1Session, isConciergeRole, isStaffRole } from '../store';

export interface ConciergeRequestDetailPageProps {
  requestId: UUID;
  /** Back link handler — router-agnostic so the router wiring stays in App.tsx. */
  onBack?: () => void;
}

interface LoadedState {
  request: AccessRequest;
  approvals: AccessApproval[];
  pass: Pass | null;
  visits: VisitLog[];
  incidents: AccessIncident[];
}

type PageState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: LoadedState };

type PendingAction = null | 'approve' | 'reject' | 'escalate';

export function ConciergeRequestDetailPage({
  requestId,
  onBack,
}: ConciergeRequestDetailPageProps) {
  const session = useV1Session();
  const canAct = isConciergeRole(session.role) || isStaffRole(session.role);

  const [state, setState] = useState<PageState>({ kind: 'loading' });
  const [refreshToken, setRefreshToken] = useState(0);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [actionComment, setActionComment] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const detail = await api.accessRequests.getById(requestId);
      const fullPass: Pass | null = detail.pass
        ? (await api.passes.getById(detail.pass.id)).pass
        : null;
      const visits: VisitLog[] = fullPass
        ? (await api.visits.list({ pass_id: fullPass.id, limit: 50 })).visit_logs
        : [];
      let incidents: AccessIncident[] = [];
      if (fullPass) {
        try {
          const res = await api.incidents.list({});
          incidents = res.incidents.filter((i) => i.related_pass_id === fullPass.id);
        } catch {
          // Non-fatal: incidents are a secondary view.  Leave empty on error.
          incidents = [];
        }
      }
      setState({
        kind: 'ready',
        data: {
          request: detail.access_request,
          approvals: detail.approvals,
          pass: fullPass,
          visits,
          incidents,
        },
      });
    } catch (err) {
      const message = isV1ApiError(err)
        ? err.kind === 'not_found'
          ? 'Заявка не найдена или удалена.'
          : err.kind === 'forbidden'
            ? 'Нет доступа к этой заявке.'
            : err.message
        : 'Не удалось загрузить заявку.';
      setState({ kind: 'error', message });
    }
  }, [requestId]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const openAction = useCallback((kind: Exclude<PendingAction, null>) => {
    setPendingAction(kind);
    setActionComment('');
    setActionError(null);
  }, []);

  const closeAction = useCallback(() => {
    setPendingAction(null);
    setActionComment('');
    setActionError(null);
  }, []);

  const runAction = useCallback(async () => {
    if (!pendingAction) return;
    setActionError(null);
    if (pendingAction === 'reject' && !actionComment.trim()) {
      setActionError('Укажите причину отклонения');
      return;
    }
    setActionSubmitting(true);
    try {
      if (pendingAction === 'approve') {
        await api.accessRequests.approve(requestId, actionComment.trim() || undefined);
      } else if (pendingAction === 'reject') {
        await api.accessRequests.reject(requestId, actionComment.trim());
      } else if (pendingAction === 'escalate') {
        await api.accessRequests.escalate(requestId, actionComment.trim() || undefined);
      }
      setPendingAction(null);
      setActionComment('');
      setRefreshToken((t) => t + 1);
    } catch (err) {
      setActionError(
        isV1ApiError(err) ? err.message : 'Не удалось применить действие',
      );
    } finally {
      setActionSubmitting(false);
    }
  }, [pendingAction, actionComment, requestId]);

  const handlePassRevoked = useCallback((updated: Pass) => {
    setState((prev) => {
      if (prev.kind !== 'ready') return prev;
      return { kind: 'ready', data: { ...prev.data, pass: updated } };
    });
    // Re-fetch to catch any side-effects (visit-log row for revoke, etc.)
    setRefreshToken((t) => t + 1);
  }, []);

  return (
    <div className={uiClasses.pageShell}>
      <header className={uiClasses.pageHeader}>
        <Inline>
          {onBack ? (
            <Button variant="ghost" onClick={onBack}>
              ← Назад
            </Button>
          ) : null}
          <h1 className={uiClasses.pageTitle}>Заявка на доступ</h1>
        </Inline>
        <p className={uiClasses.pageSubtitle}>
          <span className={uiClasses.textMono}>{requestId.slice(0, 8)}…</span>
        </p>
      </header>

      {state.kind === 'loading' ? (
        <Inline>
          <Spinner />
          <span className={uiClasses.textMuted}>Загрузка…</span>
        </Inline>
      ) : state.kind === 'error' ? (
        <Stack>
          <Alert tone="error">{state.message}</Alert>
          <Inline>
            <Button variant="secondary" onClick={() => setRefreshToken((t) => t + 1)}>
              Повторить
            </Button>
          </Inline>
        </Stack>
      ) : (
        <Stack>
          <AccessRequestCard
            request={state.data.request}
            actions={
              canAct ? (
                <ConciergeActions
                  status={state.data.request.status}
                  disabled={actionSubmitting || pendingAction !== null}
                  onAction={openAction}
                />
              ) : null
            }
          />

          {pendingAction ? (
            <Card
              title={
                pendingAction === 'approve'
                  ? 'Одобрить заявку'
                  : pendingAction === 'reject'
                    ? 'Отклонить заявку'
                    : 'Эскалировать'
              }
            >
              <Field
                label={pendingAction === 'reject' ? 'Причина отклонения' : 'Комментарий'}
                id="v1-ar-action"
                error={actionError ?? undefined}
              >
                {pendingAction === 'reject' ? (
                  <Input
                    id="v1-ar-action"
                    value={actionComment}
                    onChange={(e) => setActionComment(e.target.value)}
                    disabled={actionSubmitting}
                    placeholder="Например, данные посетителя не подтверждены"
                  />
                ) : (
                  <Textarea
                    id="v1-ar-action"
                    value={actionComment}
                    onChange={(e) => setActionComment(e.target.value)}
                    disabled={actionSubmitting}
                    placeholder="Необязательный комментарий"
                  />
                )}
              </Field>
              <Inline>
                <Button
                  onClick={runAction}
                  loading={actionSubmitting}
                  variant={pendingAction === 'reject' ? 'danger' : 'primary'}
                >
                  Подтвердить
                </Button>
                <Button variant="ghost" onClick={closeAction} disabled={actionSubmitting}>
                  Отмена
                </Button>
              </Inline>
            </Card>
          ) : null}

          <AccessRequestLifecycle
            request={state.data.request}
            approvals={state.data.approvals}
            pass={state.data.pass}
            visits={state.data.visits}
            incidents={state.data.incidents}
            propertyType={session.property_type ?? null}
            onPassRevoked={handlePassRevoked}
          />
        </Stack>
      )}
    </div>
  );
}

// ─── Concierge actions (decides which buttons are available) ───────────────

interface ConciergeActionsProps {
  status: AccessRequest['status'];
  disabled: boolean;
  onAction: (kind: 'approve' | 'reject' | 'escalate') => void;
}

function ConciergeActions({ status, disabled, onAction }: ConciergeActionsProps) {
  const canDecide = status === 'new' || status === 'pending_approval';
  if (!canDecide) return null;
  return (
    <Inline>
      <Button variant="secondary" onClick={() => onAction('approve')} disabled={disabled}>
        Одобрить
      </Button>
      <Button variant="danger" onClick={() => onAction('reject')} disabled={disabled}>
        Отклонить
      </Button>
      <Button variant="ghost" onClick={() => onAction('escalate')} disabled={disabled}>
        Эскалация
      </Button>
    </Inline>
  );
}
