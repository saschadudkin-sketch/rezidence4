import React, { useEffect, useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import s from '../styles.module.css';

interface Property {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  plan: string;
  hostname: string | null;
  is_active: boolean;
  created_at: string;
}

export function PropertiesPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    try {
      const { properties } = await api.get<{ properties: Property[] }>('/properties');
      setProperties(properties);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <>
      <div className={s.headerBar}>
        <div>
          <h1 className={s.pageTitle}>Объекты</h1>
          <p className={s.pageSubtitle}>Управление жилыми комплексами на платформе</p>
        </div>
        <button type="button" className={s.btn} onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? 'Закрыть' : 'Новый объект'}
        </button>
      </div>

      {error && <div className={s.error}>{error}</div>}

      {showCreate && (
        <CreatePropertyForm
          onCreated={() => { setShowCreate(false); void load(); }}
        />
      )}

      {properties.length === 0 ? (
        <div className={s.card}><div className={s.empty}>Пока нет ни одного объекта</div></div>
      ) : (
        <div className={s.card}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Название</th>
                <th>Slug</th>
                <th>Hostname</th>
                <th>Тариф</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {properties.map((p) => (
                <tr key={p.id}>
                  <td><Link to={`/properties/${p.slug}`}>{p.name}</Link></td>
                  <td><code>{p.slug}</code></td>
                  <td>{p.hostname || <span className={s.badge}>—</span>}</td>
                  <td><span className={s.badge}>{p.plan}</span></td>
                  <td>
                    {p.is_active
                      ? <span className={`${s.badge} ${s.badgeOk}`}>активен</span>
                      : <span className={`${s.badge} ${s.badgeOff}`}>отключён</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function CreatePropertyForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({
    slug: '', name: '', address: '', db_connection_url: '',
    plan: 'standard', timezone: 'Europe/Moscow', contact_email: '', contact_phone: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/properties', {
        slug: form.slug.trim().toLowerCase(),
        name: form.name.trim(),
        address: form.address.trim() || null,
        db_connection_url: form.db_connection_url.trim(),
        plan: form.plan,
        timezone: form.timezone,
        contact_email: form.contact_email.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const upd = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [k]: e.target.value }));

  return (
    <form className={s.card} onSubmit={onSubmit}>
      <h2 className={s.cardTitle}>Новый объект</h2>
      {error && <div className={s.error}>{error}</div>}
      <div className={s.detailGrid}>
        <div className={s.formRow}>
          <label>Название</label>
          <input className={s.input} required value={form.name} onChange={upd('name')} />
        </div>
        <div className={s.formRow}>
          <label>Slug</label>
          <input className={s.input} required value={form.slug} onChange={upd('slug')} placeholder="zamoskvorechya" />
          <div className={s.hint}>Латиница, цифры, дефисы, 3-50 символов</div>
        </div>
        <div className={s.formRow}>
          <label>Адрес</label>
          <input className={s.input} value={form.address} onChange={upd('address')} />
        </div>
        <div className={s.formRow}>
          <label>DB connection URL</label>
          <input className={s.input} required value={form.db_connection_url} onChange={upd('db_connection_url')} placeholder="postgresql://…" />
        </div>
        <div className={s.formRow}>
          <label>Тариф</label>
          <select className={s.select} value={form.plan} onChange={upd('plan')}>
            <option value="standard">standard</option>
            <option value="premium">premium</option>
            <option value="enterprise">enterprise</option>
          </select>
        </div>
        <div className={s.formRow}>
          <label>Временная зона</label>
          <input className={s.input} value={form.timezone} onChange={upd('timezone')} />
        </div>
        <div className={s.formRow}>
          <label>Контакт — email</label>
          <input className={s.input} type="email" value={form.contact_email} onChange={upd('contact_email')} />
        </div>
        <div className={s.formRow}>
          <label>Контакт — телефон</label>
          <input className={s.input} value={form.contact_phone} onChange={upd('contact_phone')} />
        </div>
      </div>
      <button type="submit" className={s.btn} disabled={submitting}>
        {submitting ? 'Создание…' : 'Создать объект'}
      </button>
    </form>
  );
}
