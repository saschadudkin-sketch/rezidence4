/**
 * Summary card for an access-request — used in resident list and as the
 * header in the concierge lifecycle page.
 */

import type { ReactNode } from 'react';
import type { AccessRequest } from '../api/types';
import { Badge, Card, Inline, uiClasses } from './ui';
import {
  formatDateTime,
  formatRequestStatus,
  formatRequestType,
  formatWindow,
  requestStatusTone,
} from './formatters';

export interface AccessRequestCardProps {
  request: AccessRequest;
  actions?: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
}

export function AccessRequestCard({
  request,
  actions,
  children,
  onClick,
}: AccessRequestCardProps) {
  const subjectLine =
    request.request_type === 'vehicle_access'
      ? 'Заявка на въезд авто'
      : request.visitor_name || 'Посетитель не указан';
  const tone = requestStatusTone(request.status);

  return (
    <Card
      title={
        <Inline>
          <span>{subjectLine}</span>
          <Badge tone="gold">{formatRequestType(request.request_type)}</Badge>
        </Inline>
      }
      subtitle={`Создана ${formatDateTime(request.created_at)} · ${formatWindow(
        request.starts_at,
        request.ends_at,
      )}`}
      actions={
        <Inline>
          <Badge tone={tone}>{formatRequestStatus(request.status)}</Badge>
          {actions}
        </Inline>
      }
    >
      {request.visitor_phone ? (
        <p className={uiClasses.textMuted}>Телефон: {request.visitor_phone}</p>
      ) : null}
      {request.reason ? (
        <p className={`${uiClasses.textBody} ${uiClasses.marginTop2}`}>{request.reason}</p>
      ) : null}
      {children ? <div className={uiClasses.marginTop3}>{children}</div> : null}
      {onClick ? (
        <div className={uiClasses.marginTop3}>
          <button type="button" onClick={onClick} className={uiClasses.linkButton}>
            Подробнее →
          </button>
        </div>
      ) : null}
    </Card>
  );
}
