import { useState } from 'react';
import { toLocalDateTimeInputValue } from '../utils/dateInput';

/**
 * fmtScheduled — formats a scheduled date to a human-readable Russian string.
 * A-03: extracted from useCreateRequest.js (was previously defined there).
 */
export const fmtScheduled = (s) => {
  if (!s) return '';
  const d    = new Date(s);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString())
    return 'Сегодня в ' + time;
  if (d.toDateString() === new Date(Date.now() + 86_400_000).toDateString())
    return 'Завтра в ' + time;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) + ' в ' + time;
};

export const minDateTime = () => {
  const d = new Date(Date.now() + 5 * 60_000);
  d.setSeconds(0, 0);
  return toLocalDateTimeInputValue(d);
};

export const SCHEDULE_PRESETS = [
  { label: 'Через 1 час',       mins: 60  },
  { label: 'Через 2 часа',      mins: 120 },
  { label: 'Сегодня в 18:00',   fn: () => { const d = new Date(); d.setHours(18, 0, 0, 0); return d; } },
  { label: 'Завтра утром',       fn: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; } },
];

/**
 * useScheduleForm — manages the schedule-later UI state.
 * A-03: extracted from useCreateRequest.js.
 */
export function useScheduleForm() {
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');

  const applyPreset = (preset) => {
    const d = preset.fn ? preset.fn() : new Date(Date.now() + preset.mins * 60_000);
    d.setSeconds(0, 0);
    setScheduledFor(toLocalDateTimeInputValue(d));
  };

  return { showSchedule, setShowSchedule, scheduledFor, setScheduledFor, applyPreset };
}
