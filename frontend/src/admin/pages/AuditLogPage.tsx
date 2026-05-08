import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import s from '../styles.module.css';

interface AuditEntry {
  id: string;
  action: string;
  admin_id: string | null;
  admin_name: string | null;
  admin_email: string | null;
  property_id: string | null;
  property_slug: string | null;
  property_name: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

interface AuditResponse {
  entries: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

const PAGE_SIZE = 50;

export function AuditLogPage() {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [actionFilter, setActionFilter] = useState('');

  const load = useCallback(async () => {
    try {
      setError(null);
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(offset));
      if (actionFilter.trim()) params.set('action', actionFilter.trim());
      const resp = await api.get<AuditResponse>(`/audit-log?${params.toString()}`);
      setData(resp);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }, [actionFilter, offset]);

  useEffect(() => { void load(); }, [load]);

  const total = data?.total ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <h1 className={s.pageTitle}>Журнал действий</h1>
      <p className={s.pageSubtitle}>Полная история операций в платформе</p>

      {error && <div className={s.error}>{error}</div>}

      <div className={s.filterBar}>
        <input
          className={s.input}
          placeholder="Фильтр по действию (напр. property.updated)"
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setOffset(0); }}
        />
      </div>

      <div className={s.card}>
        {!data ? (
          <div className={s.loading}>Загрузка…</div>
        ) : data.entries.length === 0 ? (
          <div className={s.empty}>По этому фильтру ничего не найдено</div>
        ) : (
          <>
            <table className={s.table}>
              <caption className={s.tableCaption}>Журнал аудита</caption>
              <thead>
                <tr>
                  <th>Когда</th>
                  <th>Кто</th>
                  <th>Объект</th>
                  <th>Действие</th>
                  <th>Детали</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.created_at).toLocaleString('ru-RU')}</td>
                    <td>{row.admin_name || row.admin_email || <span className={s.badge}>системa</span>}</td>
                    <td>{row.property_slug || <span className={s.badge}>—</span>}</td>
                    <td>{row.action}</td>
                    <td><pre className={s.auditDetails}>{row.details ? JSON.stringify(row.details, null, 2) : ''}</pre></td>
                    <td><code style={{ fontSize: '0.75rem' }}>{row.ip_address || '—'}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={s.pager}>
              <button
                type="button"
                className={`${s.btn} ${s.btnSecondary}`}
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                ← Предыдущие
              </button>
              <span>Страница {page} из {totalPages} · Всего записей: {total}</span>
              <button
                type="button"
                className={`${s.btn} ${s.btnSecondary}`}
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Следующие →
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
