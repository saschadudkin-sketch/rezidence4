/**
 * Vehicle summary with inline blacklist/whitelist actions.
 *
 * Used on the guard-console vehicles tab.  Does not try to own refresh —
 * parent owns the React-Query invalidation after mutations.
 */

import { useState } from 'react';
import type { Vehicle } from '../api/types';
import { vehiclesApi } from '../api/vehicles';
import { Badge, Button, Card, Field, Inline, Input, uiClasses } from './ui';
import { isV1ApiError } from '../api';

export interface VehicleCardProps {
  vehicle: Vehicle;
  onChanged?: (vehicle: Vehicle) => void;
}

type PendingAction = 'whitelist' | 'blacklist' | 'clear' | null;

export function VehicleCard({ vehicle, onChanged }: VehicleCardProps) {
  const [action, setAction] = useState<PendingAction>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: Exclude<PendingAction, null>) {
    setSubmitting(true);
    setError(null);
    try {
      let next: Vehicle;
      if (kind === 'whitelist') {
        const res = await vehiclesApi.whitelist(vehicle.id);
        next = res.vehicle;
      } else if (kind === 'blacklist') {
        if (!reason.trim()) {
          setError('Причина обязательна');
          setSubmitting(false);
          return;
        }
        const res = await vehiclesApi.blacklist(vehicle.id, reason.trim());
        next = res.vehicle;
      } else {
        const res = await vehiclesApi.clearFlags(vehicle.id);
        next = res.vehicle;
      }
      setAction(null);
      setReason('');
      onChanged?.(next);
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось обновить авто');
    } finally {
      setSubmitting(false);
    }
  }

  const brandModel =
    [vehicle.brand, vehicle.model].filter(Boolean).join(' ') || 'Марка не указана';
  const toneBadge: { tone: 'success' | 'error' | 'neutral'; label: string } =
    vehicle.is_blacklisted
      ? { tone: 'error', label: 'В чёрном списке' }
      : vehicle.is_whitelisted
        ? { tone: 'success', label: 'Белый список' }
        : { tone: 'neutral', label: 'Нет флагов' };

  return (
    <Card
      elevated
      title={
        <Inline>
          <span className={uiClasses.textMono}>{vehicle.plate_number}</span>
          <Badge tone={toneBadge.tone}>{toneBadge.label}</Badge>
        </Inline>
      }
      subtitle={`${brandModel}${vehicle.color ? ' · ' + vehicle.color : ''}`}
      actions={
        action === null ? (
          <Inline>
            {!vehicle.is_whitelisted ? (
              <Button variant="secondary" onClick={() => run('whitelist')}>
                В белый список
              </Button>
            ) : null}
            {!vehicle.is_blacklisted ? (
              <Button variant="danger" onClick={() => setAction('blacklist')}>
                В чёрный список
              </Button>
            ) : null}
            {vehicle.is_whitelisted || vehicle.is_blacklisted ? (
              <Button variant="ghost" onClick={() => run('clear')}>
                Сбросить флаги
              </Button>
            ) : null}
          </Inline>
        ) : null
      }
    >
      {vehicle.notes ? <p className={uiClasses.textMuted}>{vehicle.notes}</p> : null}

      {action === 'blacklist' ? (
        <div className={uiClasses.marginTop3}>
          <Field label="Причина занесения в ЧС" error={error}>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
              placeholder="Например, повторные нарушения"
            />
          </Field>
          <Inline>
            <Button variant="danger" loading={submitting} onClick={() => run('blacklist')}>
              Подтвердить
            </Button>
            <Button variant="ghost" onClick={() => setAction(null)} disabled={submitting}>
              Отмена
            </Button>
          </Inline>
        </div>
      ) : null}
    </Card>
  );
}
