import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import s from '../styles.module.css';

interface Stats {
  totals: { total: number; active: number; disabled: number };
  byPlan: Record<string, number>;
  recentAudit: AuditRow[];
}

interface AuditRow {
  id: string;
  action: string;
  admin_name: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<Stats>('/stats')
      .then((data) => { if (!cancelled) setStats(data); })
      .catch((err: ApiError) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <h1 className={s.pageTitle}>Обзор</h1>
      <p className={s.pageSubtitle}>Состояние платформы DomHub</p>

      {error && <div className={s.error}>{error}</div>}

      {stats && (
        <>
          <div className={s.statsGrid}>
            <div className={s.stat}>
              <div className={s.statLabel}>Всего объектов</div>
              <div className={s.statValue}>{stats.totals.total}</div>
            </div>
            <div className={s.stat}>
              <div className={s.statLabel}>Активные</div>
              <div className={s.statValue}>{stats.totals.active}</div>
            </div>
            <div className={s.stat}>
              <div className={s.statLabel}>Отключённые</div>
              <div className={s.statValue}>{stats.totals.disabled}</div>
            </div>
            {Object.entries(stats.byPlan).map(([plan, count]) => (
              <div key={plan} className={s.stat}>
                <div className={s.statLabel}>Тариф {plan}</div>
                <div className={s.statValue}>{count}</div>
              </div>
            ))}
          </div>

          <div className={s.card}>
            <h2 className={s.cardTitle}>Последние действия</h2>
            {stats.recentAudit.length === 0 ? (
              <div className={s.empty}>Пока ничего не происходило</div>
            ) : (
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Когда</th>
                    <th>Кто</th>
                    <th>Действие</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recentAudit.map((row) => (
                    <tr key={row.id}>
                      <td>{new Date(row.created_at).toLocaleString('ru-RU')}</td>
                      <td>{row.admin_name || <span className={s.badge}>системa</span>}</td>
                      <td>{row.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{ marginTop: '0.75rem', fontSize: '0.8125rem' }}>
              <Link to="/audit" className={s.backLink}>Весь журнал →</Link>
            </div>
          </div>
        </>
      )}
    </>
  );
}
