import React, { useEffect, useState, FormEvent } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import s from '../styles.module.css';

interface Admin {
  id: string;
  email: string;
  name: string;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}

export function AdminsPage() {
  const { admin: me } = useAuth();
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    try {
      setError(null);
      const { admins } = await api.get<{ admins: Admin[] }>('/admins');
      setAdmins(admins);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  useEffect(() => { void load(); }, []);

  async function deactivate(id: string) {
    if (!confirm('Отключить этого админа? Восстановить можно только через БД.')) return;
    try {
      setError(null);
      await api.patch(`/admins/${id}/deactivate`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <>
      <div className={s.headerBar}>
        <div>
          <h1 className={s.pageTitle}>Админы платформы</h1>
          <p className={s.pageSubtitle}>Сотрудники DomHub с доступом к панели</p>
        </div>
        <button type="button" className={s.btn} onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? 'Закрыть' : 'Новый админ'}
        </button>
      </div>

      {error && <div className={s.error}>{error}</div>}

      {showCreate && (
        <CreateAdminForm onCreated={() => { setShowCreate(false); void load(); }} />
      )}

      <div className={s.card}>
        {admins.length === 0 ? (
          <div className={s.empty}>Нет активных админов</div>
        ) : (
          <table className={s.table}>
            <thead>
              <tr>
                <th>Имя</th>
                <th>Email</th>
                <th>Статус</th>
                <th>Последний вход</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td>{a.email}</td>
                  <td>
                    {a.is_active
                      ? <span className={`${s.badge} ${s.badgeOk}`}>активен</span>
                      : <span className={`${s.badge} ${s.badgeOff}`}>отключён</span>}
                  </td>
                  <td>{a.last_login_at ? new Date(a.last_login_at).toLocaleString('ru-RU') : <span className={s.badge}>никогда</span>}</td>
                  <td className={s.rowActions}>
                    {a.is_active && a.id !== me?.id && (
                      <button type="button" className={`${s.btn} ${s.btnDanger}`} onClick={() => deactivate(a.id)}>
                        Отключить
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function CreateAdminForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({ email: '', name: '', password: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (form.password.length < 12) {
      setError('Пароль должен быть минимум 12 символов');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/admins', {
        email: form.email.trim().toLowerCase(),
        name: form.name.trim(),
        password: form.password,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className={s.card} onSubmit={onSubmit}>
      <h2 className={s.cardTitle}>Новый админ</h2>
      {error && <div className={s.error}>{error}</div>}
      <div className={s.formRow}>
        <label>Имя</label>
        <input className={s.input} required value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className={s.formRow}>
        <label>Email</label>
        <input className={s.input} type="email" required value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </div>
      <div className={s.formRow}>
        <label>Пароль</label>
        <input className={s.input} type="password" required minLength={12} value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <div className={s.hint}>Минимум 12 символов. Передайте админу в защищённом канале.</div>
      </div>
      <button type="submit" className={s.btn} disabled={submitting}>
        {submitting ? 'Создание…' : 'Создать админа'}
      </button>
    </form>
  );
}
