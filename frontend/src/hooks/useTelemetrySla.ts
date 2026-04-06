import { useEffect, useMemo, useState } from 'react';
import { getSlaSnapshot, subscribeUxMetrics } from '../utils/telemetryContract';

export function useTelemetrySla(windowMs = 24 * 60 * 60 * 1000) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const off = subscribeUxMetrics(() => setTick((x) => x + 1));
    const t = setInterval(() => setTick((x) => x + 1), 15_000);
    return () => {
      off();
      clearInterval(t);
    };
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- tick is an intentional version counter that triggers recompute on new metrics
  return useMemo(() => getSlaSnapshot(windowMs), [windowMs, tick]);
}
