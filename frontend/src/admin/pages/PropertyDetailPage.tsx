import React, { useEffect, useState, FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import s from '../styles.module.css';

type PropertyType = 'residential_complex' | 'club_house' | 'cottage_community';
type PropertyStatus = 'active' | 'suspended' | 'maintenance' | 'terminated';

interface Property {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  plan: string;
  timezone: string;
  hostname: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  feature_flags: Record<string, boolean> | null;
  // Phase 1 (D-lite) fields
  property_type?: PropertyType;
  status?: PropertyStatus;
  logo_url?: string | null;
  primary_color?: string | null;
  management_company_id?: string | null;
}

interface AuditEntry {
  id: string;
  action: string;
  admin_name: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

interface ManagementCompanyOption {
  id: string;
  slug: string;
  name: string;
  status: string;
}

interface Response {
  property: Property;
  recentAudit: AuditEntry[];
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

export function PropertyDetailPage() {
  const { slug = '' } = useParams();
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [mcOptions, setMcOptions] = useState<ManagementCompanyOption[]>([]);

  async function load() {
    try {
      setError(null);
      const resp = await api.get<Response>(`/properties/${slug}`);
      setData(resp);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  useEffect(() => { void load(); }, [slug]);

  // Fetch MCs once for the reassignment dropdown.  Failures are silent —
  // the admin can always clear the field or enter a new MC via the MC page.
  useEffect(() => {
    (async () => {
      try {
        const { managementCompanies } = await api.get<{ managementCompanies: ManagementCompanyOption[] }>(
          '/management-companies',
        );
        setMcOptions(managementCompanies);
      } catch {
        setMcOptions([]);
      }
    })();
  }, []);

  async function patch(changes: Partial<Property>) {
    try {
      setError(null);
      setMsg(null);
      const { property } = await api.patch<{ property: Property }>(`/properties/${slug}`, changes);
      setData((prev) => (prev ? { ...prev, property } : prev));
      setMsg('Сохранено');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function toggleActive() {
    if (!data) return;
    try {
      setError(null);
      const endpoint = data.property.is_active ? 'disable' : 'enable';
      const { property } = await api.post<{ property: Property }>(`/properties/${slug}/${endpoint}`);
      setData((prev) => (prev ? { ...prev, property } : prev));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  if (error && !data) return <div className={s.error}>{error}</div>;
  if (!data) return <div className={s.loading}>Загрузка…</div>;

  const p = data.property;

  // Look up the MC name from the options list so we can render a friendly
  // label instead of the raw UUID in the card.
  const currentMc = p.management_company_id
    ? mcOptions.find((m) => m.id === p.management_company_id)
    : null;

  return (
    <>
      <Link to="/properties" className={s.backLink}>← Все объекты</Link>
      <div className={s.headerBar}>
        <div>
          <h1 className={s.pageTitle}>{p.name}</h1>
          <p className={s.pageSubtitle}>
            <code>{p.slug}</code>
            {' · '}
            {p.status
              ? (
                <span className={p.status === 'active' ? `${s.badge} ${s.badgeOk}` : `${s.badge} ${s.badgeOff}`}>
                  {PROPERTY_STATUS_LABELS[p.status]}
                </span>
              )
              : (p.is_active
                ? <span className={`${s.badge} ${s.badgeOk}`}>активен</span>
                : <span className={`${s.badge} ${s.badgeOff}`}>отключён</span>
              )}
            {p.property_type && (
              <>
                {' · '}
                <span className={s.badge}>{PROPERTY_TYPE_LABELS[p.property_type]}</span>
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          className={`${s.btn} ${p.is_active ? s.btnDanger : ''}`}
          onClick={toggleActive}
        >
          {p.is_active ? 'Отключить' : 'Включить'}
        </button>
      </div>

      {error && <div className={s.error}>{error}</div>}
      {msg && <div className={s.card} style={{ background: '#dff0df', borderColor: '#b8d9b8', color: '#2a6a2a' }}>{msg}</div>}

      <div className={s.card}>
        <h2 className={s.cardTitle}>Карточка</h2>
        <EditableField label="Название" value={p.name}
          onSave={(v) => patch({ name: v })} />
        <EditableField label="Hostname" value={p.hostname || ''}
          hint="DNS-имя, на котором доступен объект (напр. zamoskvorechya.domhub.su). Пусто = не привязан."
          allowEmpty
          onSave={(v) => patch({ hostname: v || null })} />
        <EditableField label="Адрес" value={p.address || ''} allowEmpty
          onSave={(v) => patch({ address: v || null })} />
        <EditableField label="Контакт — email" value={p.contact_email || ''} allowEmpty
          onSave={(v) => patch({ contact_email: v || null })} />
        <EditableField label="Контакт — телефон" value={p.contact_phone || ''} allowEmpty
          onSave={(v) => patch({ contact_phone: v || null })} />

        <EditableSelect
          label="Тип объекта"
          value={p.property_type || 'residential_complex'}
          options={[
            { value: 'residential_complex', label: 'ЖК' },
            { value: 'club_house', label: 'Клубный дом' },
            { value: 'cottage_community', label: 'Коттеджный посёлок' },
          ]}
          onSave={(v) => patch({ property_type: v as PropertyType })}
        />

        <EditableSelect
          label="Статус"
          value={p.status || (p.is_active ? 'active' : 'suspended')}
          options={[
            { value: 'active', label: 'активен' },
            { value: 'maintenance', label: 'обслуживание' },
            { value: 'suspended', label: 'приостановлен' },
            { value: 'terminated', label: 'закрыт' },
          ]}
          hint="maintenance / suspended возвращают 503 для тенантного трафика"
          onSave={(v) => patch({ status: v as PropertyStatus })}
        />

        <dl className={s.kv} style={{ marginTop: '1rem' }}>
          <dt>Тариф</dt><dd>{p.plan}</dd>
          <dt>TZ</dt><dd>{p.timezone}</dd>
          <dt>Создан</dt><dd>{new Date(p.created_at).toLocaleString('ru-RU')}</dd>
          <dt>Обновлён</dt><dd>{new Date(p.updated_at).toLocaleString('ru-RU')}</dd>
        </dl>
      </div>

      <div className={s.card}>
        <h2 className={s.cardTitle}>Бренд</h2>
        <p className={s.pageSubtitle}>Показывается в шапке тенантного SPA</p>
        <EditableField label="Логотип (URL)" value={p.logo_url || ''} allowEmpty
          hint="Только https://, ≤ 2048 символов"
          onSave={(v) => patch({ logo_url: v || null })} />
        <EditableField label="Основной цвет" value={p.primary_color || ''} allowEmpty
          hint="CSS-цвет (#7c3aed, slateblue, …)"
          onSave={(v) => patch({ primary_color: v || null })} />
        {(p.logo_url || p.primary_color) && (
          <div className={s.formRow}>
            <label>Превью</label>
            <div
              style={{
                padding: '0.75rem 1rem',
                borderRadius: 8,
                background: p.primary_color || '#eee',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              {p.logo_url
                ? <img src={p.logo_url} alt="logo" style={{ height: 28, background: '#fff', padding: 2, borderRadius: 4 }} />
                : <span style={{ fontWeight: 700 }}>{p.name}</span>}
              <span style={{ opacity: 0.85 }}>{p.name}</span>
            </div>
          </div>
        )}
      </div>

      <div className={s.card}>
        <h2 className={s.cardTitle}>Управляющая компания</h2>
        <div className={s.formRow}>
          <label>Текущая УК</label>
          <div style={{ flex: 1, padding: '0.5rem 0' }}>
            {currentMc
              ? <Link to={`/management-companies/${currentMc.slug}`}>{currentMc.name}</Link>
              : <span style={{ color: '#8a8275' }}>— не назначена —</span>}
          </div>
        </div>
        <ManagementCompanySelector
          current={p.management_company_id || null}
          options={mcOptions}
          onChange={(id) => patch({ management_company_id: id })}
        />
      </div>

      <div className={s.card}>
        <h2 className={s.cardTitle}>Последние изменения</h2>
        {data.recentAudit.length === 0 ? (
          <div className={s.empty}>Ничего не менялось</div>
        ) : (
          <table className={s.table}>
            <thead>
              <tr><th>Когда</th><th>Кто</th><th>Действие</th><th>Детали</th></tr>
            </thead>
            <tbody>
              {data.recentAudit.map((row) => (
                <tr key={row.id}>
                  <td>{new Date(row.created_at).toLocaleString('ru-RU')}</td>
                  <td>{row.admin_name || <span className={s.badge}>системa</span>}</td>
                  <td>{row.action}</td>
                  <td><pre className={s.auditDetails}>{row.details ? JSON.stringify(row.details, null, 2) : ''}</pre></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/**
 * Inline-editable text field.  Shows the current value; click "Изменить" to
 * edit in place; save or cancel.  Keeps the detail page to one round-trip
 * per field instead of maintaining a big dirty form.
 */
function EditableField({
  label, value, hint, allowEmpty = false, onSave,
}: {
  label: string;
  value: string;
  hint?: string;
  allowEmpty?: boolean;
  onSave: (value: string) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => { setDraft(value); }, [value]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!allowEmpty && !trimmed) return;
    if (trimmed === value.trim()) { setEditing(false); return; }
    setSaving(true);
    try {
      await onSave(trimmed);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={s.formRow}>
      <label>{label}</label>
      {editing ? (
        <form onSubmit={submit} className={s.inlineForm}>
          <input
            className={s.input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
          />
          <button type="submit" className={s.btn} disabled={saving}>
            {saving ? '…' : 'OK'}
          </button>
          <button type="button" className={`${s.btn} ${s.btnSecondary}`} onClick={() => { setDraft(value); setEditing(false); }}>
            Отмена
          </button>
        </form>
      ) : (
        <div className={s.inlineForm}>
          <div style={{ flex: 1, padding: '0.5rem 0' }}>
            {value || <span style={{ color: '#8a8275' }}>—</span>}
          </div>
          <button type="button" className={`${s.btn} ${s.btnSecondary}`} onClick={() => setEditing(true)}>
            Изменить
          </button>
        </div>
      )}
      {hint && <div className={s.hint}>{hint}</div>}
    </div>
  );
}

/**
 * Same inline-edit dance as EditableField but for enum-like fields.  Kept as
 * a sibling rather than a prop on the existing component to keep the input
 * typing honest (native <select> vs <input>).
 */
function EditableSelect({
  label, value, options, hint, onSave,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  hint?: string;
  onSave: (value: string) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => { setDraft(value); }, [value]);

  async function submit() {
    if (draft === value) { setEditing(false); return; }
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const currentLabel = options.find((o) => o.value === value)?.label ?? value;

  return (
    <div className={s.formRow}>
      <label>{label}</label>
      {editing ? (
        <div className={s.inlineForm}>
          <select
            className={s.select}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
          >
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button type="button" className={s.btn} disabled={saving} onClick={() => void submit()}>
            {saving ? '…' : 'OK'}
          </button>
          <button type="button" className={`${s.btn} ${s.btnSecondary}`} onClick={() => { setDraft(value); setEditing(false); }}>
            Отмена
          </button>
        </div>
      ) : (
        <div className={s.inlineForm}>
          <div style={{ flex: 1, padding: '0.5rem 0' }}>{currentLabel}</div>
          <button type="button" className={`${s.btn} ${s.btnSecondary}`} onClick={() => setEditing(true)}>
            Изменить
          </button>
        </div>
      )}
      {hint && <div className={s.hint}>{hint}</div>}
    </div>
  );
}

/**
 * MC selector — small dedicated component because "null" is a legal value
 * (unlink from any MC) and <select> can't natively carry that semantics
 * without a sentinel.  We use '' internally and map it to null on save.
 */
function ManagementCompanySelector({
  current,
  options,
  onChange,
}: {
  current: string | null;
  options: ManagementCompanyOption[];
  onChange: (id: string | null) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<string>(current ?? '');
  const [saving, setSaving] = useState(false);

  React.useEffect(() => { setDraft(current ?? ''); }, [current]);

  async function save() {
    if (draft === (current ?? '')) return;
    setSaving(true);
    try {
      await onChange(draft || null);
    } finally {
      setSaving(false);
    }
  }

  // Only active MCs are allowed as assignment targets — this matches the
  // backend check on PATCH / POST.  Suspended/terminated MCs show up
  // grayed-out via :disabled so admins see why they're not pickable.
  return (
    <div className={s.formRow}>
      <label>Сменить УК</label>
      <div className={s.inlineForm}>
        <select
          className={s.select}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        >
          <option value="">— не назначена —</option>
          {options.map((mc) => (
            <option key={mc.id} value={mc.id} disabled={mc.status !== 'active'}>
              {mc.name}{mc.status !== 'active' ? ` (${mc.status})` : ''}
            </option>
          ))}
        </select>
        <button type="button" className={s.btn} disabled={saving || draft === (current ?? '')} onClick={() => void save()}>
          {saving ? '…' : 'Сохранить'}
        </button>
      </div>
      <div className={s.hint}>Можно оставить пустым — объект будет отображаться как self-managed</div>
    </div>
  );
}
