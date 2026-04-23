/**
 * Guard-console scan panel — QR token or plate input → /visits/verify.
 *
 * Stays self-contained: it owns its verdict-cache.  Parent supplies the
 * property_id and optional onVerified callback (to bubble up the verdict
 * for invalidations — revoked passes, etc.).
 */

import { useState } from 'react';
import { visitsApi } from '../api/visits';
import type { UUID, VerifyMode, VerifyResult } from '../api/types';
import { Alert, Button, Card, Field, Inline, Input, Select, Stack, uiClasses } from './ui';
import { VerifyResultCard } from './VerifyResultCard';
import { isV1ApiError } from '../api';
import { normalizePlate } from '../api/vehicles';

export interface ScanPanelProps {
  propertyId: UUID;
  onVerified?: (result: VerifyResult, request: { mode: VerifyMode; value: string }) => void;
}

interface HistoryItem {
  at: string;
  mode: VerifyMode;
  value: string;
  allowed: boolean;
  reason?: string;
}

export function ScanPanel({ propertyId, onVerified }: ScanPanelProps) {
  const [mode, setMode] = useState<VerifyMode>('qr');
  const [value, setValue] = useState('');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      setError(mode === 'qr' ? 'Введите QR-токен' : 'Введите номер авто');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body =
        mode === 'qr'
          ? { property_id: propertyId, mode, token: trimmed }
          : { property_id: propertyId, mode, plate: normalizePlate(trimmed) };
      const res = await visitsApi.verify(body);
      setResult(res);
      setHistory((prev) =>
        [
          {
            at: new Date().toISOString(),
            mode,
            value: mode === 'plate' ? normalizePlate(trimmed) : trimmed,
            allowed: res.allowed,
            reason: res.reason,
          },
          ...prev,
        ].slice(0, 20),
      );
      onVerified?.(res, { mode, value: trimmed });
      setValue('');
    } catch (err) {
      setError(isV1ApiError(err) ? err.message : 'Не удалось выполнить проверку');
      setResult(null);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Stack>
      <Card title="Сканирование">
        <form onSubmit={submit}>
          <Field label="Режим" hint="QR-токен — для пропуска гостя. Plate — для въезда авто.">
            <Select value={mode} onChange={(e) => setMode(e.target.value as VerifyMode)}>
              <option value="qr">QR-токен</option>
              <option value="plate">Гос. номер</option>
            </Select>
          </Field>
          <Field
            label={mode === 'qr' ? 'QR-токен' : 'Гос. номер'}
            error={error}
            hint={
              mode === 'plate'
                ? 'Ввод автоматически приводится к верхнему регистру'
                : 'Токен — 32-значная hex-строка'
            }
          >
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={mode === 'qr' ? 'например, a7b8…' : 'например, A001AA77'}
              disabled={submitting}
              autoFocus
            />
          </Field>
          <Inline>
            <Button type="submit" loading={submitting}>
              Проверить
            </Button>
            {result ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setResult(null);
                  setValue('');
                }}
                disabled={submitting}
              >
                Сбросить
              </Button>
            ) : null}
          </Inline>
        </form>
      </Card>

      {result ? <VerifyResultCard result={result} /> : null}

      {history.length > 0 ? (
        <Card title="История сканирований (текущая сессия)">
          <ul className={uiClasses.timeline}>
            {history.map((h, idx) => (
              <li key={`${h.at}-${idx}`} className={uiClasses.timelineItem}>
                <span className={uiClasses.timelineTime}>
                  {new Date(h.at).toLocaleTimeString('ru-RU')}
                </span>
                <span className={uiClasses.timelineBody}>
                  <strong>{h.mode === 'qr' ? 'QR' : 'Plate'}</strong> · {h.value} ·{' '}
                  {h.allowed ? '✓ разрешено' : `✕ ${h.reason ?? 'deny'}`}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Alert tone="info">
          Подтверждения сканирования появятся здесь. Список хранится в памяти вкладки — при
          перезагрузке очищается.
        </Alert>
      )}
    </Stack>
  );
}
