import SectionHeader from './SectionHeader';

function SlaItem({ label, value, ok }) {
  return (
    <div className="stat-card sla-item-card">
      <div className="stat-lbl">{label}</div>
      <div className="stat-val sla-item-value">{value}</div>
      <div className={'u-fs11 ' + (ok ? 'sla-ok' : 'sla-breached')}>
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
  const trendWindowHours = Math.round(snapshot.trends.windowMs / (60 * 60 * 1000));
  const reconnectTrend = snapshot.trends.reconnectAvgDeltaMs;
  const timeoutTrend = snapshot.trends.timeoutRateDeltaPct;
  const actionTrend = snapshot.trends.actionSuccessDeltaPct;

  return (
    <>
      <SectionHeader title="SLA dashboard (24ч)" />
      <div className="stats-grid">
        <SlaItem label="Reconnect avg" value={`${reconnectAvg} ms`} ok={snapshot.reconnect.slaMet} />
        <SlaItem label="Reconnect p95" value={`${reconnectP95} ms`} ok={reconnectP95 <= 30000} />
        <SlaItem label="Timeout rate" value={`${timeoutRate}%`} ok={snapshot.availability.slaMet} />
        <SlaItem label="Action success" value={`${actionRate}%`} ok={snapshot.action.slaMet} />
      </div>
      <div className="u-fs12 u-t4 sla-samples">
        Samples: reconnect={snapshot.reconnect.samples}, actions={snapshot.action.success + snapshot.action.failure}, views={snapshot.viewReadyCount}
      </div>
      <div className="u-fs12 u-t4 u-mt8">
        Trend ({trendWindowHours}ч vs prev {trendWindowHours}ч): reconnect {reconnectTrend >= 0 ? '+' : ''}{reconnectTrend}ms ·
        timeout {timeoutTrend >= 0 ? '+' : ''}{timeoutTrend.toFixed(2)}pp ·
        action success {actionTrend >= 0 ? '+' : ''}{actionTrend.toFixed(1)}pp
      </div>
    </>
  );
}
