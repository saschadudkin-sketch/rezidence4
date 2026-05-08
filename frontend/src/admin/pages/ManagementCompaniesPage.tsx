import React, { useEffect, useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import s from '../styles.module.css';

// Phase 1 (D-lite): management-company listing + create form.  Detail is a
// separate file (ManagementCompanyDetailPage).  The tables are seeded empty
// by migration 005 — the first MC is created by a platform_admin the first
// time an actual УК onboards (RECONCILIATION.md §1.2, ROADMAP.md §"Фаза 1").

type MCStatus = 'active' | 'suspended' | 'terminated';

interface ManagementCompany {
  id: string;
  slug: string;
  name: string;
  inn: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  website: string | null;
  logo_url: string | null;
  status: MCStatus;
  created_at: string;
  updated_at: string;
  // GET /management-companies adds this via a subquery — useful as a "do we
  // have any properties yet?" hint in the list view.
  properties_count?: number;
}

const MC_STATUS_LABELS: Record<MCStatus, string> = {
  active: 'активна',
  suspended: 'приостановлена',
  terminated: 'закрыта',
};

function statusBadgeClass(status: MCStatus): string {
  if (status === 'active') return `${s.badge} ${s.badgeOk}`;
  return `${s.badge} ${s.badgeOff}`;
}

export function ManagementCompaniesPage() {
  const [items, setItems] = useState<ManagementCompany[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    try {
      const { managementCompanies } = await api.get<{ managementCompanies: ManagementCompany[] }>(
        '/management-companies',
      );
      setItems(managementCompanies);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <>
      <div className={s.headerBar}>
        <div>
          <h1 className={s.pageTitle}>Управляющие компании</h1>
          <p className={s.pageSubtitle}>УК, владеющие одним или несколькими объектами</p>
        </div>
        <button type="button" className={s.btn} onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? 'Закрыть' : 'Новая УК'}
        </button>
      </div>

      {error && <div className={s.error}>{error}</div>}

      {showCreate && (
        <CreateManagementCompanyForm
          onCreated={() => { setShowCreate(false); void load(); }}
        />
      )}

      {items.length === 0 ? (
        <div className={s.card}>
          <div className={s.empty}>
            Пока ни одной УК. Объекты могут существовать без привязки к УК
            (self-managed); привяжите их после создания.
          </div>
        </div>
      ) : (
        <div className={s.card}>
          <table className={s.table}>
            <caption className={s.tableCaption}>Управляющие компании</caption>
            <thead>
              <tr>
                <th>Название</th>
                <th>Slug</th>
                <th>ИНН</th>
                <th>Объектов</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {items.map((mc) => (
                <tr key={mc.id}>
                  <td><Link to={`/management-companies/${mc.slug}`}>{mc.name}</Link></td>
                  <td><code>{mc.slug}</code></td>
                  <td>{mc.inn || <span className={s.badge}>—</span>}</td>
                  <td>{mc.properties_count ?? 0}</td>
                  <td>
                    <span className={statusBadgeClass(mc.status)}>
                      {MC_STATUS_LABELS[mc.status]}
                    </span>
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

function CreateManagementCompanyForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({
    slug: '',
    name: '',
    inn: '',
    contact_email: '',
    contact_phone: '',
    website: '',
    logo_url: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/management-companies', {
        slug: form.slug.trim().toLowerCase(),
        name: form.name.trim(),
        inn: form.inn.trim() || null,
        contact_email: form.contact_email.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
        website: form.website.trim() || null,
        logo_url: form.logo_url.trim() || null,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const upd = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [k]: e.target.value }));

  return (
    <form className={s.card} onSubmit={onSubmit}>
      <h2 className={s.cardTitle}>Новая УК</h2>
      {error && <div className={s.error}>{error}</div>}
      <div className={s.detailGrid}>
        <div className={s.formRow}>
          <label htmlFor="mc-create-name">Название</label>
          <input id="mc-create-name" className={s.input} required value={form.name} onChange={upd('name')} />
        </div>
        <div className={s.formRow}>
          <label htmlFor="mc-create-slug">Slug</label>
          <input id="mc-create-slug" className={s.input} required value={form.slug} onChange={upd('slug')} placeholder="rezidentsii-zamoskv" />
          <div className={s.hint}>Латиница, цифры, дефисы, 3-80 символов</div>
        </div>
        <div className={s.formRow}>
          <label htmlFor="mc-create-inn">ИНН</label>
          <input id="mc-create-inn" className={s.input} value={form.inn} onChange={upd('inn')} placeholder="7707083893" />
          <div className={s.hint}>10 или 12 цифр. Можно оставить пустым.</div>
        </div>
        <div className={s.formRow}>
          <label htmlFor="mc-create-email">Контакт — email</label>
          <input id="mc-create-email" className={s.input} type="email" value={form.contact_email} onChange={upd('contact_email')} />
        </div>
        <div className={s.formRow}>
          <label htmlFor="mc-create-phone">Контакт — телефон</label>
          <input id="mc-create-phone" className={s.input} value={form.contact_phone} onChange={upd('contact_phone')} />
        </div>
        <div className={s.formRow}>
          <label htmlFor="mc-create-website">Сайт</label>
          <input id="mc-create-website" className={s.input} value={form.website} onChange={upd('website')} placeholder="https://…" />
          <div className={s.hint}>Только https://</div>
        </div>
        <div className={s.formRow}>
          <label htmlFor="mc-create-logo">Логотип (URL)</label>
          <input id="mc-create-logo" className={s.input} value={form.logo_url} onChange={upd('logo_url')} placeholder="https://cdn.…/logo.png" />
          <div className={s.hint}>Только https://, ≤ 2048 символов</div>
        </div>
      </div>
      <button type="submit" className={s.btn} disabled={submitting}>
        {submitting ? 'Создание…' : 'Создать УК'}
      </button>
    </form>
  );
}
