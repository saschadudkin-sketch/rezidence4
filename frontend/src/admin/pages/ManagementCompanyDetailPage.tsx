import React, { useCallback, useEffect, useState, FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import s from '../styles.module.css';

// Phase 1 (D-lite) MC detail.  Mirrors PropertyDetailPage in shape: inline
// editing for every field, an admin sub-list, a recent-audit feed, a status
// toggle.  Kept deliberately close so admins don't have to relearn
// interaction patterns when switching between property and MC contexts.

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
}

interface PropertyRef {
  id: string;
  slug: string;
  name: string;
  status: string;
  is_active: boolean;
  created_at: string;
}

interface AuditEntry {
  id: string;
  action: string;
  admin_name: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

interface MCAdmin {
  id: string;
  email: string;
  name: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}

interface Response {
  managementCompany: ManagementCompany;
  properties: PropertyRef[];
  recentAudit: AuditEntry[];
}

const MC_STATUS_LABELS: Record<MCStatus, string> = {
  active: 'активна',
  suspended: 'приостановлена',
  terminated: 'закрыта',
};

export function ManagementCompanyDetailPage() {
  const { slug = '' } = useParams();
  const [data, setData] = useState<Response | null>(null);
  const [admins, setAdmins] = useState<MCAdmin[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const resp = await api.get<Response>(`/management-companies/${slug}`);
      setData(resp);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }, [slug]);

  const loadAdmins = useCallback(async () => {
    try {
      const { admins } = await api.get<{ admins: MCAdmin[] }>(`/management-companies/${slug}/admins`);
      setAdmins(admins);
    } catch {
      // 404 here means the MC was deleted mid-view; the main load() will
      // surface that error.  Everything else we intentionally swallow
      // because the admins block is a secondary widget.
      setAdmins([]);
    }
  }, [slug]);

  useEffect(() => {
    void load();
    void loadAdmins();
  }, [load, loadAdmins]);

  async function patch(changes: Partial<ManagementCompany>) {
    try {
      setError(null);
      setMsg(null);
      const { managementCompany } = await api.patch<{ managementCompany: ManagementCompany }>(
        `/management-companies/${slug}`,
        changes,
      );
      setData((prev) => (prev ? { ...prev, managementCompany } : prev));
      setMsg('Сохранено');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  if (error && !data) return <div className={s.error}>{error}</div>;
  if (!data) return <div className={s.loading}>Загрузка…</div>;

  const mc = data.managementCompany;

  return (
    <>
      <Link to="/management-companies" className={s.backLink}>← Все УК</Link>
      <div className={s.headerBar}>
        <div>
          <h1 className={s.pageTitle}>{mc.name}</h1>
          <p className={s.pageSubtitle}>
            <code>{mc.slug}</code>
            {' · '}
            <span className={mc.status === 'active' ? `${s.badge} ${s.badgeOk}` : `${s.badge} ${s.badgeOff}`}>
              {MC_STATUS_LABELS[mc.status]}
            </span>
          </p>
        </div>
      </div>

      {error && <div className={s.error}>{error}</div>}
      {msg && <div className={s.card} style={{ background: '#dff0df', borderColor: '#b8d9b8', color: '#2a6a2a' }}>{msg}</div>}

      <div className={s.card}>
        <h2 className={s.cardTitle}>Карточка</h2>
        <EditableField label="Название" value={mc.name}
          onSave={(v) => patch({ name: v })} />
        <EditableField label="ИНН" value={mc.inn || ''} allowEmpty
          hint="10 или 12 цифр, можно оставить пустым"
          onSave={(v) => patch({ inn: v || null })} />
        <EditableField label="Контакт — email" value={mc.contact_email || ''} allowEmpty
          onSave={(v) => patch({ contact_email: v || null })} />
        <EditableField label="Контакт — телефон" value={mc.contact_phone || ''} allowEmpty
          onSave={(v) => patch({ contact_phone: v || null })} />
        <EditableField label="Сайт" value={mc.website || ''} allowEmpty
          hint="Только https://"
          onSave={(v) => patch({ website: v || null })} />
        <EditableField label="Логотип (URL)" value={mc.logo_url || ''} allowEmpty
          hint="Только https://, ≤ 2048 символов"
          onSave={(v) => patch({ logo_url: v || null })} />

        <EditableSelect
          label="Статус"
          value={mc.status}
          options={[
            { value: 'active', label: 'активна' },
            { value: 'suspended', label: 'приостановлена' },
            { value: 'terminated', label: 'закрыта' },
          ]}
          hint="suspended / terminated убирает УК из списка при назначении объекту"
          onSave={(v) => patch({ status: v as MCStatus })}
        />

        <dl className={s.kv} style={{ marginTop: '1rem' }}>
          <dt>Создана</dt><dd>{new Date(mc.created_at).toLocaleString('ru-RU')}</dd>
          <dt>Обновлена</dt><dd>{new Date(mc.updated_at).toLocaleString('ru-RU')}</dd>
        </dl>
      </div>

      <div className={s.card}>
        <h2 className={s.cardTitle}>Объекты под управлением</h2>
        {data.properties.length === 0 ? (
          <div className={s.empty}>Пока ни одного объекта. Назначьте УК из карточки объекта.</div>
        ) : (
          <table className={s.table}>
            <caption className={s.tableCaption}>Объекты под управлением</caption>
            <thead>
              <tr><th>Название</th><th>Slug</th><th>Статус</th><th>Создан</th></tr>
            </thead>
            <tbody>
              {data.properties.map((p) => (
                <tr key={p.id}>
                  <td><Link to={`/properties/${p.slug}`}>{p.name}</Link></td>
                  <td><code>{p.slug}</code></td>
                  <td>
                    <span className={p.is_active ? `${s.badge} ${s.badgeOk}` : `${s.badge} ${s.badgeOff}`}>
                      {p.status || (p.is_active ? 'active' : 'inactive')}
                    </span>
                  </td>
                  <td>{new Date(p.created_at).toLocaleString('ru-RU')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className={s.card}>
        <h2 className={s.cardTitle}>Администраторы УК</h2>
        {admins.length === 0 ? (
          <div className={s.empty}>
            Пока не назначены. В Phase 1 MC-админы добавляются вручную через
            БД; форма приглашения появится в следующем спринте.
          </div>
        ) : (
          <table className={s.table}>
            <caption className={s.tableCaption}>Администраторы управляющей компании</caption>
            <thead>
              <tr><th>Имя</th><th>Email</th><th>Последний вход</th><th>Статус</th></tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.id}>
                  <td>{a.name || <span className={s.badge}>—</span>}</td>
                  <td>{a.email}</td>
                  <td>
                    {a.last_login_at
                      ? new Date(a.last_login_at).toLocaleString('ru-RU')
                      : <span className={s.badge}>—</span>}
                  </td>
                  <td>
                    <span className={a.is_active ? `${s.badge} ${s.badgeOk}` : `${s.badge} ${s.badgeOff}`}>
                      {a.is_active ? 'активен' : 'отключён'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className={s.card}>
        <h2 className={s.cardTitle}>Последние изменения</h2>
        {data.recentAudit.length === 0 ? (
          <div className={s.empty}>Ничего не менялось</div>
        ) : (
          <table className={s.table}>
            <caption className={s.tableCaption}>Последние изменения управляющей компании</caption>
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
  const fieldId = React.useId();

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
      <label htmlFor={fieldId}>{label}</label>
      {editing ? (
        <form onSubmit={submit} className={s.inlineForm}>
          <input id={fieldId} className={s.input} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
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
  const fieldId = React.useId();

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
      <label htmlFor={fieldId}>{label}</label>
      {editing ? (
        <div className={s.inlineForm}>
          <select id={fieldId} className={s.select} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus>
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
