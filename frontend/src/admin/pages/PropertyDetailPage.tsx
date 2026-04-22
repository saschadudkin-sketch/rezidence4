import React, { useEffect, useState, FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import s from '../styles.module.css';

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
}

interface AuditEntry {
  id: string;
  action: string;
  admin_name: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

interface Response {
  property: Property;
  recentAudit: AuditEntry[];
}

export function PropertyDetailPage() {
  const { slug = '' } = useParams();
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

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

  return (
    <>
      <Link to="/properties" className={s.backLink}>← Все объекты</Link>
      <div className={s.headerBar}>
        <div>
          <h1 className={s.pageTitle}>{p.name}</h1>
          <p className={s.pageSubtitle}>
            <code>{p.slug}</code>
            {' · '}
            {p.is_active
              ? <span className={`${s.badge} ${s.badgeOk}`}>активен</span>
              : <span className={`${s.badge} ${s.badgeOff}`}>отключён</span>}
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

        <dl className={s.kv} style={{ marginTop: '1rem' }}>
          <dt>Тариф</dt><dd>{p.plan}</dd>
          <dt>TZ</dt><dd>{p.timezone}</dd>
          <dt>Создан</dt><dd>{new Date(p.created_at).toLocaleString('ru-RU')}</dd>
          <dt>Обновлён</dt><dd>{new Date(p.updated_at).toLocaleString('ru-RU')}</dd>
        </dl>
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
