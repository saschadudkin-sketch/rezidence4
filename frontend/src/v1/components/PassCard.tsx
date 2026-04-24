/**
 * Compact pass card with inline revoke action.
 */

import { useState } from 'react';
import type { Pass } from '../api/types';
import { passesApi } from '../api/passes';
import { Badge, Button, Card, Field, Inline, Input, uiClasses } from './ui';
import {
  formatDateTime,
  formatPassStatus,
  formatPassType,
  formatWindow,
  passStatusTone,
} from './formatters';
import { isV1ApiError } from '../api';

export interface PassCardProps {
  pass: Pass;
  /** Called with the updated pass after successful revoke. */
  onRevoked?: (pass: Pass) => void;
  /** Hide action buttons — used in read-only lifecycle views. */
  readOnly?: boolean;
}

export function PassCard({ pass, onRevoked, readOnly }: PassCardProps) {
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!reason.trim()) {
      setError('Укажите причину отзыва');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { pass: updated } = await passesApi.revoke(pass.id, reason.trim());
      setShowForm(false);
      setReason('');
      onRevoked?.(updated);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось отозвать пропуск');
    } finally {
      setSubmitting(false);
    }
  }

  const subjectLabel =
    pass.subject_type === 'vehicle'
      ? 'Авто'
      : pass.subject_type === 'resident'
        ? 'Резидент'
        : pass.subject_type === 'staff'
          ? 'Сотрудник'
          : pass.subject_type === 'contractor_user'
            ? 'Подрядчик'
            : 'Гость';

  const canRevoke =
    !readOnly && (pass.status === 'active' || pass.status === 'blocked');

  return (
    <Card
      elevated
      title={
        <Inline>
          <span>Пропуск</span>
          <Badge tone="gold">{formatPassType(pass.pass_type)}</Badge>
          <Badge tone="neutral">{subjectLabel}</Badge>
        </Inline>
      }
      subtitle={formatWindow(pass.valid_from, pass.valid_until)}
      actions={
        <Inline>
          <Badge tone={passStatusTone(pass.status)}>{formatPassStatus(pass.status)}</Badge>
          {canRevoke && !showForm ? (
            <Button variant="danger" onClick={() => setShowForm(true)}>
              Отозвать
            </Button>
          ) : null}
        </Inline>
      }
    >
      <ul className={uiClasses.metaRow}>
        <li className={uiClasses.metaItem}>
          ID пропуска:
          <strong className={uiClasses.textMono}>{pass.id.slice(0, 8)}…</strong>
        </li>
        {pass.revoked_at ? (
          <li className={uiClasses.metaItem}>
            Отозван: <strong>{formatDateTime(pass.revoked_at)}</strong>
          </li>
        ) : null}
        {pass.revoked_reason ? (
          <li className={uiClasses.metaItem}>
            Причина: <strong>{pass.revoked_reason}</strong>
          </li>
        ) : null}
      </ul>

      {showForm ? (
        <div className={uiClasses.marginTop3}>
          <Field label="Причина отзыва" error={error}>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Например, гость отменил визит"
              disabled={submitting}
            />
          </Field>
          <Inline>
            <Button onClick={submit} loading={submitting} variant="danger">
              Подтвердить отзыв
            </Button>
            <Button variant="ghost" onClick={() => setShowForm(false)} disabled={submitting}>
              Отмена
            </Button>
          </Inline>
        </div>
      ) : null}
    </Card>
  );
}
