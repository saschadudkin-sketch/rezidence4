import { useState } from 'react';
import { toLocalDateTimeInputValue } from '../utils/dateInput';

type SchedulePreset = {
  label: string;
  mins?: number;
  fn?: () => Date;
};

export const fmtScheduled = (value?: string | number | Date | null): string => {
  if (!value) return '';
  const date = new Date(value);
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === new Date().toDateString()) return 'Сегодня в ' + time;
  if (date.toDateString() === new Date(Date.now() + 86_400_000).toDateString()) return 'Завтра в ' + time;
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) + ' в ' + time;
};

export const minDateTime = (): string => {
  const date = new Date(Date.now() + 5 * 60_000);
  date.setSeconds(0, 0);
  return toLocalDateTimeInputValue(date);
};

export const SCHEDULE_PRESETS: SchedulePreset[] = [
  { label: 'Через 1 час', mins: 60 },
  { label: 'Через 2 часа', mins: 120 },
  { label: 'Сегодня в 18:00', fn: () => { const date = new Date(); date.setHours(18, 0, 0, 0); return date; } },
  { label: 'Завтра утром', fn: () => { const date = new Date(); date.setDate(date.getDate() + 1); date.setHours(8, 0, 0, 0); return date; } },
];

export function useScheduleForm() {
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');

  const applyPreset = (preset: SchedulePreset) => {
    const date = preset.fn ? preset.fn() : new Date(Date.now() + (preset.mins ?? 0) * 60_000);
    date.setSeconds(0, 0);
    setScheduledFor(toLocalDateTimeInputValue(date));
  };

  return { showSchedule, setShowSchedule, scheduledFor, setScheduledFor, applyPreset };
}
