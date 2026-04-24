/**
 * Lifecycle view for an access-request: approvals timeline + pass + visits + incidents.
 * Pure presentation — data fetching lives in the parent page.
 */

import type {
  AccessApproval,
  AccessIncident,
  AccessRequest,
  Pass,
  VisitLog,
} from '../api/types';
import { Badge, Card, EmptyState, Inline, Stack, uiClasses } from './ui';
import { PassCard } from './PassCard';
import {
  formatDateTime,
  formatIncidentType,
  formatSeverity,
  formatWindow,
  severityTone,
} from './formatters';

export interface AccessRequestLifecycleProps {
  request: AccessRequest;
  approvals: AccessApproval[];
  pass: Pass | null;
  visits: VisitLog[];
  incidents: AccessIncident[];
  onPassRevoked?: (pass: Pass) => void;
}

export function AccessRequestLifecycle({
  request,
  approvals,
  pass,
  visits,
  incidents,
  onPassRevoked,
}: AccessRequestLifecycleProps) {
  return (
    <Stack>
      <Card title="Параметры заявки">
        <ul className={uiClasses.metaRow}>
          <li className={uiClasses.metaItem}>
            Тип: <strong>{request.request_type}</strong>
          </li>
          <li className={uiClasses.metaItem}>
            Окно: <strong>{formatWindow(request.starts_at, request.ends_at)}</strong>
          </li>
          <li className={uiClasses.metaItem}>
            Требует согласования:{' '}
            <strong>{request.approval_required ? 'да' : 'нет'}</strong>
          </li>
          {request.visitor_name ? (
            <li className={uiClasses.metaItem}>
              Посетитель: <strong>{request.visitor_name}</strong>
            </li>
          ) : null}
          {request.visitor_phone ? (
            <li className={uiClasses.metaItem}>
              Телефон: <strong>{request.visitor_phone}</strong>
            </li>
          ) : null}
          {request.vehicle_id ? (
            <li className={uiClasses.metaItem}>
              Авто:{' '}
              <strong className={uiClasses.textMono}>
                {request.vehicle_id.slice(0, 8)}…
              </strong>
            </li>
          ) : null}
          {request.target_unit_id ? (
            <li className={uiClasses.metaItem}>
              Квартира:{' '}
              <strong className={uiClasses.textMono}>
                {request.target_unit_id.slice(0, 8)}…
              </strong>
            </li>
          ) : null}
        </ul>
        {request.reason ? <p className={uiClasses.textBody}>{request.reason}</p> : null}
      </Card>

      <Card title="История согласований">
        {approvals.length === 0 ? (
          <EmptyState>Нет согласований — заявка ещё не рассматривалась.</EmptyState>
        ) : (
          <ul className={uiClasses.timeline}>
            {approvals.map((a) => (
              <li key={a.id} className={uiClasses.timelineItem}>
                <span className={uiClasses.timelineTime}>{formatDateTime(a.created_at)}</span>
                <span className={uiClasses.timelineBody}>
                  <strong>{a.decision}</strong>
                  {' · '}
                  {a.comment ?? <em>без комментария</em>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Пропуск">
        {pass ? (
          <PassCard pass={pass} onRevoked={onPassRevoked} />
        ) : (
          <EmptyState>Пропуск ещё не выпущен.</EmptyState>
        )}
      </Card>

      <Card title="Visit-logs">
        {visits.length === 0 ? (
          <EmptyState>Событий по пропуску пока нет.</EmptyState>
        ) : (
          <ul className={uiClasses.timeline}>
            {visits.map((v) => {
              const allowed =
                v.event_type === 'entry_allowed' ||
                v.event_type === 'exit_allowed' ||
                v.event_type === 'manual_admit';
              return (
                <li key={v.id} className={uiClasses.timelineItem}>
                  <span className={uiClasses.timelineTime}>{formatDateTime(v.occurred_at)}</span>
                  <span className={uiClasses.timelineBody}>
                    <Inline>
                      <Badge tone={allowed ? 'success' : 'error'}>{v.event_type}</Badge>
                      <span className={uiClasses.textMuted}>{v.event_source}</span>
                      {v.vehicle_plate ? (
                        <span className={uiClasses.textMono}>{v.vehicle_plate}</span>
                      ) : null}
                      {v.person_label ? <span>{v.person_label}</span> : null}
                    </Inline>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Связанные инциденты">
        {incidents.length === 0 ? (
          <EmptyState>Инцидентов по этой заявке нет.</EmptyState>
        ) : (
          <ul className={uiClasses.timeline}>
            {incidents.map((i) => (
              <li key={i.id} className={uiClasses.timelineItem}>
                <span className={uiClasses.timelineTime}>{formatDateTime(i.created_at)}</span>
                <span className={uiClasses.timelineBody}>
                  <Inline>
                    <Badge tone={severityTone(i.severity)}>{formatSeverity(i.severity)}</Badge>
                    <Badge tone="neutral">{formatIncidentType(i.incident_type)}</Badge>
                    <span>{i.title}</span>
                  </Inline>
                  {i.description ? (
                    <p className={uiClasses.textMuted}>{i.description}</p>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Stack>
  );
}
