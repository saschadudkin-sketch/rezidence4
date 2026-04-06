/**
 * Web Vitals reporting — отправляет CLS, INP, LCP, FCP, TTFB в аналитику.
 *
 * В production метрики отправляются через CustomEvent `rz:web-vital`, который
 * подхватывает analytics/monitoring pipeline (например, Datadog RUM или backend /api/v1/client-logs).
 * В dev — выводятся в console для локальной отладки.
 */
import { onCLS, onINP, onLCP, onFCP, onTTFB } from 'web-vitals';

/**
 * @param {import('web-vitals').Metric} metric
 */
function sendToAnalytics(metric) {
  if (import.meta.env.DEV) {
    // Удобный вывод для локальной разработки: имя, значение, рейтинг
    console.info(`[WebVitals] ${metric.name}: ${Math.round(metric.value)}ms (${metric.rating})`);
  }

  // Dispatch custom event — подхватывается аналитикой без прямой зависимости
  window.dispatchEvent(new CustomEvent('rz:web-vital', {
    detail: {
      name:   metric.name,
      value:  metric.value,
      rating: metric.rating,  // 'good' | 'needs-improvement' | 'poor'
      id:     metric.id,
    },
  }));
}

export function reportWebVitals() {
  onCLS(sendToAnalytics);
  onINP(sendToAnalytics);
  onLCP(sendToAnalytics);
  onFCP(sendToAnalytics);
  onTTFB(sendToAnalytics);
}
