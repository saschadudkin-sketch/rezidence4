/**
 * Shows a verify-pass verdict with pass summary and optional incident link.
 * Purely presentational — no network calls from here.
 */

import type { VerifyResult } from '../api/types';
import { Badge, Card, Inline, uiClasses } from './ui';
import {
  formatDenyReason,
  formatPassStatus,
  formatPassType,
  formatWindow,
  passStatusTone,
} from './formatters';

export interface VerifyResultCardProps {
  result: VerifyResult;
}

export function VerifyResultCard({ result }: VerifyResultCardProps) {
  const allow = result.allowed;
  const headline = allow ? 'Проход разрешён' : 'Проход запрещён';
  const className = `${uiClasses.card} ${uiClasses.cardElevated} ${
    allow ? uiClasses.verdictAllow : uiClasses.verdictDeny
  }`;

  return (
    <section className={className}>
      <div className={uiClasses.verdictHead}>
        <span
          className={`${uiClasses.verdictIcon} ${
            allow ? uiClasses.verdictIconAllow : uiClasses.verdictIconDeny
          }`}
          aria-hidden
        >
          {allow ? '✓' : '✕'}
        </span>
        <div>
          <h3 className={uiClasses.verdictHeadText}>{headline}</h3>
          {!allow ? (
            <p className={uiClasses.textMuted}>{formatDenyReason(result.reason)}</p>
          ) : null}
        </div>
      </div>

      {result.pass ? (
        <Card>
          <Inline>
            <Badge tone="gold">{formatPassType(result.pass.pass_type)}</Badge>
            <Badge tone={passStatusTone(result.pass.status)}>
              {formatPassStatus(result.pass.status)}
            </Badge>
          </Inline>
          <p className={`${uiClasses.textMuted} ${uiClasses.marginTop2}`}>
            Окно: {formatWindow(result.pass.valid_from, result.pass.valid_until)}
          </p>
          <p className={uiClasses.textDim}>
            Pass ID <span className={uiClasses.textMono}>{result.pass.id}</span>
          </p>
        </Card>
      ) : null}

      <ul className={`${uiClasses.metaRow} ${uiClasses.marginTop3}`}>
        {result.visit_log_id ? (
          <li className={uiClasses.metaItem}>
            Visit log:{' '}
            <strong className={uiClasses.textMono}>{result.visit_log_id.slice(0, 8)}…</strong>
          </li>
        ) : null}
        {result.incident_id ? (
          <li className={uiClasses.metaItem}>
            Инцидент:{' '}
            <strong className={uiClasses.textMono}>{result.incident_id.slice(0, 8)}…</strong>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
