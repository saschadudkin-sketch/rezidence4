import { memo, useMemo, useState } from 'react';
import { VirtualList } from '../ui/VirtualList';
import { ReqCard } from './ReqCard';
import { AppIcon } from '../ui/AppIcon';
import { CAT_LABEL, PASS_DURATION_LABEL, STS_LABEL } from '../constants/index';
import { fmtDate, fmtTime } from '../utils';

function getRequestSummary(req) {
  return req.visitorName || req.comment || req.carPlate || CAT_LABEL[req.category] || 'Заявка';
}

function getRequestMeta(req) {
  const bits = [
    req.createdByName,
    req.createdByApt && req.createdByApt !== '—' ? `Апарт. ${req.createdByApt}` : null,
    req.passDuration ? PASS_DURATION_LABEL[req.passDuration] : null,
    req.scheduledFor ? `По расписанию ${fmtDate(req.scheduledFor)} ${fmtTime(req.scheduledFor)}` : null,
  ].filter(Boolean);
  return bits.join(' • ');
}

const OperationalRow = memo(function OperationalRow({
  req,
  expanded,
  onToggle,
  userRole,
  userName,
  userId,
  onRepeat,
  onEdit,
  onDelete,
  onCancel,
  highlightId,
  onHighlighted,
}) {
  const summary = useMemo(() => getRequestSummary(req), [req]);
  const meta = useMemo(() => getRequestMeta(req), [req]);

  return (
    <div className={`opreq${expanded ? ' is-expanded' : ''}`}>
      <button type="button" className="opreq-row" onClick={onToggle} aria-expanded={expanded}>
        <div className="opreq-main">
          <div className="opreq-title">
            <span className="opreq-type">
              <AppIcon name={req.type === 'tech' ? 'tools' : 'ticket'} size={13} />
            </span>
            <span>{summary}</span>
          </div>
          {meta ? <div className="opreq-meta">{meta}</div> : null}
        </div>
        <div className="opreq-side">
          <span className={`badge ${req.status}`}>{STS_LABEL[req.status] || req.status}</span>
          <span className="opreq-date">{fmtDate(req.createdAt)} {fmtTime(req.createdAt)}</span>
          <span className="opreq-chevron">
            <AppIcon name={expanded ? 'chevron-up' : 'chevron-down'} size={12} />
          </span>
        </div>
      </button>
      {expanded ? (
        <div className="opreq-detail">
          <ReqCard
            req={req}
            userRole={userRole}
            userName={userName}
            userId={userId}
            onRepeat={onRepeat}
            onEdit={onEdit}
            onDelete={onDelete}
            onCancel={onCancel}
            highlightId={highlightId}
            onHighlighted={onHighlighted}
          />
        </div>
      ) : null}
    </div>
  );
});

export const OperationalRequestList = memo(function OperationalRequestList({
  items,
  userRole,
  userName,
  userId,
  onRepeat,
  onEdit,
  onDelete,
  onCancel,
  highlightId,
  onHighlighted,
  className = 'req-list req-list--compact',
}) {
  const [expandedId, setExpandedId] = useState(null);

  return (
    <VirtualList
      items={items}
      estimateSize={88}
      className={className}
      renderItem={(req) => (
        <OperationalRow
          key={req.id}
          req={req}
          expanded={expandedId === req.id}
          onToggle={() => setExpandedId((current) => current === req.id ? null : req.id)}
          userRole={userRole}
          userName={userName}
          userId={userId}
          onRepeat={onRepeat}
          onEdit={onEdit}
          onDelete={onDelete}
          onCancel={onCancel}
          highlightId={highlightId}
          onHighlighted={onHighlighted}
        />
      )}
    />
  );
});
