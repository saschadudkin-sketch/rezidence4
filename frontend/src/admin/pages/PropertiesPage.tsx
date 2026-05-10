import React, { useEffect, useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import s from '../styles.module.css';

// Phase 1 (D-lite) wire format.  The backend returns many more fields after
// migration 004 — we surface the ones that matter on the list + detail pages.
// See: platformMigrations 004, docs/product/specs/platform-v1/README.md.
type PropertyType = 'residential_complex' | 'club_house' | 'cottage_community';
type PropertyStatus = 'active' | 'suspended' | 'maintenance' | 'terminated';
type PropertyPlan = 'core_access' | 'operations' | 'portfolio' | 'enterprise';

interface Property {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  plan: PropertyPlan | string;
  hostname: string | null;
  is_active: boolean;
  // New in 004 — nullable while the migration is fresh on envs that might
  // still be on an older backend, but the new API always populates them.
  property_type?: PropertyType;
  status?: PropertyStatus;
  logo_url?: string | null;
  primary_color?: string | null;
  management_company_id?: string | null;
  created_at: string;
}

interface ManagementCompanyOption {
  id: string;
  slug: string;
  name: string;
}

const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  residential_complex: 'ЖК',
  club_house: 'Клубный дом',
  cottage_community: 'Коттеджный посёлок',
};

const PROPERTY_STATUS_LABELS: Record<PropertyStatus, string> = {
  active: 'активен',
  suspended: 'приостановлен',
  maintenance: 'обслуживание',
  terminated: 'закрыт',
};

const PROPERTY_PLAN_LABELS: Record<PropertyPlan, string> = {
  core_access: 'Core Access',
  operations: 'Operations',
  portfolio: 'Portfolio',
  enterprise: 'Enterprise / Integrations',
};

function planLabel(plan: Property['plan']): string {
  return plan in PROPERTY_PLAN_LABELS
    ? PROPERTY_PLAN_LABELS[plan as PropertyPlan]
    : String(plan);
}

function statusBadgeClass(status: PropertyStatus | undefined): string {
  // Only 'active' gets the green/ok badge.  Everything else reads as
  // "not serving traffic" in the UI and shares the neutral/off colour.
  if (status === 'active') return `${s.badge} ${s.badgeOk}`;
  return `${s.badge} ${s.badgeOff}`;
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
            <caption className={s.tableCaption}>Объекты</caption>
            <thead>
              <tr>
                <th>Название</th>
                <th>Slug</th>
                <th>Тип</th>
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
                  <td>
                    {p.property_type
                      ? <span className={s.badge}>{PROPERTY_TYPE_LABELS[p.property_type]}</span>
                      : <span className={s.badge}>—</span>}
                  </td>
                  <td>{p.hostname || <span className={s.badge}>—</span>}</td>
                  <td><span className={s.badge}>{planLabel(p.plan)}</span></td>
                  <td>
                    <span className={statusBadgeClass(p.status)}>
                      {p.status ? PROPERTY_STATUS_LABELS[p.status] : (p.is_active ? 'активен' : 'отключён')}
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

function CreatePropertyForm({ onCreated }: { onCreated: () => void }) {
  // Defaults match what the POST route assumes when a field is omitted
  // (plan='core_access', property_type='residential_complex', status='active').
  // Keeping them here makes the form's intent obvious at a glance.
  const [form, setForm] = useState({
    slug: '',
    name: '',
    address: '',
    db_connection_url: '',
    plan: 'core_access' as PropertyPlan,
    timezone: 'Europe/Moscow',
    contact_email: '',
    contact_phone: '',
    property_type: 'residential_complex' as PropertyType,
    status: 'active' as PropertyStatus,
    logo_url: '',
    primary_color: '',
    management_company_id: '' as string,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mcOptions, setMcOptions] = useState<ManagementCompanyOption[]>([]);

  // Load MC list once — the form offers them as an optional dropdown.
  // Failure is non-fatal: admins can leave the field empty and assign later.
  useEffect(() => {
    (async () => {
      try {
        const { managementCompanies } = await api.get<{ managementCompanies: ManagementCompanyOption[] }>(
          '/management-companies?status=active',
        );
        setMcOptions(managementCompanies);
      } catch {
        setMcOptions([]);
      }
    })();
  }, []);

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
        property_type: form.property_type,
        status: form.status,
        logo_url: form.logo_url.trim() || null,
        primary_color: form.primary_color.trim() || null,
        management_company_id: form.management_company_id || null,
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
          <label htmlFor="property-create-name">Название</label>
          <input id="property-create-name" className={s.input} required value={form.name} onChange={upd('name')} />
        </div>
        <div className={s.formRow}>
          <label htmlFor="property-create-slug">Slug</label>
          <input id="property-create-slug" className={s.input} required value={form.slug} onChange={upd('slug')} placeholder="zamoskvorechya" />
          <div className={s.hint}>Латиница, цифры, дефисы, 3-50 символов</div>
        </div>
        <div className={s.formRow}>
          <label htmlFor="property-create-type">Тип объекта</label>
          <select id="property-create-type" className={s.select} value={form.property_type} onChange={upd('property_type')}>
            <option value="residential_complex">ЖК</option>
            <option value="club_house">Клубный дом</option>
            <option value="cottage_community">Коттеджный посёлок</option>
          </select>
        </div>
        <div className={s.formRow}>
          <label htmlFor="property-create-status">Начальный статус</label>
          <select id="property-create-status" className={s.select} value={form.status} onChange={upd('status')}>
            <option value="active">активен</option>
            <option value="maintenance">обслуживание</option>
            <option value="suspended">приостановлен</option>
          </select>
          <div className={s.hint}>Обычно создаётся в «обслуживание», пока грузят данные</div>
        </div>
        <div className={s.formRow}>
          <label htmlFor="property-create-address">Адрес</label>
          <input id="property-create-address" className={s.input} value={form.address} onChange={upd('address')} />
        </div>
        <div className={s.formRow}>
          <label htmlFor="property-create-db-url">DB connection URL</label>
          <input id="property-create-db-url" className={s.input} required value={form.db_connection_url} onChange={upd('db_connection_url')} placeholder="postgresql://…" />
        </div>
        <div className={s.formRow}>
          <label htmlFor="property-create-plan">Тариф</label>
          <select id="property-create-plan" className={s.select} value={form.plan} onChange={upd('plan')}>
            <option value="core_access">Core Access</option>
            <option value="operations">Operations</option>
            <option value="portfolio">Portfolio</option>
            <option value="enterprise">Enterprise / Integrations</option>
          </select>
        </div>
        <div className={s.formRow}>
          <label htmlFor="property-create-timezone">Временная зона</label>
          <input id="property-create-timezone" className={s.input} value={form.timezone} onChange={upd('timezone')} />
        </div>
        <div className={s.formRow}>
          <label htmlFor="property-create-email">Контакт — email</label>
          <input id="property-create-email" className={s.input} type="email" value={form.contact_email} onChange={upd('contact_email')} />
        </div>
        <div className={s.formRow}>
          <label htmlFor="property-create-phone">Контакт — телефон</label>
          <input id="property-create-phone" className={s.input} value={form.contact_phone} onChange={upd('contact_phone')} />
        </div>
        <div className={s.formRow}>
          <label htmlFor="property-create-mc">Управляющая компания</label>
          <select id="property-create-mc" className={s.select} value={form.management_company_id} onChange={upd('management_company_id')}>
            <option value="">— не назначена —</option>
            {mcOptions.map((mc) => (
              <option key={mc.id} value={mc.id}>{mc.name}</option>
            ))}
          </select>
          <div className={s.hint}>Можно оставить пустым и назначить позже</div>
        </div>
        <div className={s.formRow}>
          <label htmlFor="property-create-logo">Логотип (URL)</label>
          <input id="property-create-logo" className={s.input} value={form.logo_url} onChange={upd('logo_url')} placeholder="https://cdn.…/logo.png" />
          <div className={s.hint}>Только https://, ≤ 2048 символов</div>
        </div>
        <div className={s.formRow}>
          <label htmlFor="property-create-primary-color">Основной цвет</label>
          <input id="property-create-primary-color" className={s.input} value={form.primary_color} onChange={upd('primary_color')} placeholder="#7c3aed" />
          <div className={s.hint}>CSS-цвет, например #7c3aed или named</div>
        </div>
      </div>
      <button type="submit" className={s.btn} disabled={submitting}>
        {submitting ? 'Создание…' : 'Создать объект'}
      </button>
    </form>
  );
}
