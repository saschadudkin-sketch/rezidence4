import SectionHeader from './SectionHeader';

function SlaItem({ label, value, ok }) {
  return (
    <div className="stat-card" style={{ minHeight: 92 }}>
      <div className="stat-lbl">{label}</div>
      <div className="stat-val" style={{ fontSize: 24 }}>{value}</div>
      <div style={{ fontSize: 11, color: ok ? 'var(--ok-t)' : 'var(--err-t)' }}>
        {ok ? 'SLA OK' : 'SLA breached'}
      </div>
    </div>
  );
}

export default function SlaDashboard({ snapshot }) {
  const reconnectP95 = snapshot.reconnect.p95Ms;
  const reconnectAvg = snapshot.reconnect.avgMs;
  const timeoutRate = snapshot.availability.timeoutRate;
  const actionRate = snapshot.action.successRate;

  return (
    <>
      <SectionHeader title="SLA dashboard (24ч)" />
      <div className="stats-grid">
        <SlaItem label="Reconnect avg" value={`${reconnectAvg} ms`} ok={snapshot.reconnect.slaMet} />
        <SlaItem label="Reconnect p95" value={`${reconnectP95} ms`} ok={reconnectP95 <= 30000} />
        <SlaItem label="Timeout rate" value={`${timeoutRate}%`} ok={snapshot.availability.slaMet} />
        <SlaItem label="Action success" value={`${actionRate}%`} ok={snapshot.action.slaMet} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--t4)', marginTop: 6 }}>
        Samples: reconnect={snapshot.reconnect.samples}, actions={snapshot.action.success + snapshot.action.failure}, views={snapshot.viewReadyCount}
      </div>
    </>
  );
}
