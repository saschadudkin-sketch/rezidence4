import { memo } from 'react';
import { CAT_LABEL, CAT_ICON } from '../constants/index.js';
import {
  useCreateRequest,
  hasVisitorFields,
  needsCarPlate,
  requiresVisitorName,
  fmtScheduled,
  minDateTime,
  toLocalDateInputValue,
  parseLocalDateInputValue,
  SCHEDULE_PRESETS,
} from '../hooks/useCreateRequest';

// ─── VisitorFields ────────────────────────────────────────────────────────────
// FIX [PERF-19]: memo — VisitorFields не имеет внутреннего состояния, рендерится
// при каждом keystroke в форме CreateModal. Мемоизация экономит перерасчёт
// всех условных блоков (needsCarPlate, hasVisitorFields, permsList и т.д.)
const VisitorFields = memo(function VisitorFields({ cat, vName, setVName, vNames, setVNames, vPhone, setVPhone,
  carPlate, setCarPlate, permsList, showPermsPicker, setShowPermsPicker, onPickPerm }) {
  return (
    <>
      {cat === 'taxi' && (
        <div className="field">
          <label className="field-lbl">Марка и номер авто *</label>
          <input className="field-inp" placeholder="Toyota Camry А123БВ777"
            value={carPlate} onChange={e => setCarPlate(e.target.value)} autoCapitalize="characters" />
        </div>
      )}
      {needsCarPlate(cat) && cat !== 'taxi' && (
        <div className="field">
          <label className="field-lbl">Марка и номер авто</label>
          <input className="field-inp" placeholder="Toyota Camry А123БВ777"
            value={carPlate} onChange={e => setCarPlate(e.target.value)} autoCapitalize="characters" />
        </div>
      )}
      {cat === 'team' && (
        <div className="field">
          <label className="field-lbl">Имена посетителей *</label>
          {/* FIX [BUG-14]: key=index ломает фокус и значения инпутов при удалении из середины.
              Оборачиваем каждое имя в объект {id, value} со стабильным id. */}
          {vNames.map((n, i) => (
            <div key={n.__id ?? i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input className="field-inp" style={{ flex: 1, marginBottom: 0 }}
                placeholder={'Посетитель ' + (i + 1)} value={typeof n === 'object' ? n.value : n}
                onChange={e => {
                  const a = [...vNames];
                  a[i] = typeof n === 'object' ? { ...n, value: e.target.value } : e.target.value;
                  setVNames(a);
                }}
                autoCapitalize="words" />
              {vNames.length > 1 && (
                <button type="button" onClick={() => setVNames(vNames.filter((_, j) => j !== i))}
                  style={{ background: 'none', border: '1px solid var(--b2)', borderRadius: 4, color: 'var(--t3)', padding: '0 10px', cursor: 'pointer', fontSize: 16, flexShrink: 0 }}>✕</button>
              )}
            </div>
          ))}
          <button type="button" onClick={() => setVNames([...vNames, ''])}
            style={{ background: 'none', border: '1px dashed var(--b3)', borderRadius: 4, color: 'var(--g2)', padding: '7px 14px', cursor: 'pointer', fontSize: 11, letterSpacing: 1, width: '100%', marginTop: 2 }}>
            + Добавить посетителя
          </button>
        </div>
      )}
      {hasVisitorFields(cat) && (
        <div className="field">
          <label className="field-lbl">{requiresVisitorName(cat) ? 'Имя посетителя *' : 'Имя посетителя'}</label>
          <input className="field-inp" placeholder="Иван Иванов"
            value={vName} onChange={e => setVName(e.target.value)} autoCapitalize="words" autoComplete="name" />
          {permsList.length > 0 && (
            <div style={{ marginTop: 4, position: 'relative' }}>
              <button type="button" onClick={() => setShowPermsPicker(p => !p)}
                style={{ background: 'var(--g-bg)', border: '1px solid var(--b3)', borderRadius: 4, color: 'var(--g2)', padding: '7px 12px', cursor: 'pointer', fontSize: 11, width: '100%', fontWeight: 500 }}>
                📋 Выбрать из постоянного списка ({permsList.length})
              </button>
              {showPermsPicker && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: 'var(--s1)', border: '1px solid var(--b2)', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,.3)', marginTop: 2, maxHeight: 180, overflowY: 'auto' }}>
                  {permsList.map(p => (
                    <button key={p.id} type="button" onClick={() => onPickPerm(p)}
                      style={{ width: '100%', background: 'none', border: 'none', padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--b1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left' }}>
                      <span style={{ fontSize: 13, color: 'var(--t1)' }}>{p.name}</span>
                      {p.phone && <span className="u-fs11-t4">{p.phone}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {hasVisitorFields(cat) && (
        <div className="field">
          <label className="field-lbl">Телефон</label>
          <input className="field-inp" placeholder="+7 000 000-00-00" type="tel"
            value={vPhone} onChange={e => setVPhone(e.target.value)} inputMode="tel" autoComplete="tel" />
        </div>
      )}
    </>
  );
});

// ─── TemplateSection ──────────────────────────────────────────────────────────

// FIX [PERF-19]: memo — TemplateSection рендерится при каждом keystroke в форме
const TemplateSection = memo(function TemplateSection({ showSaveTpl, setShowSaveTpl, tplName, setTplName, onSave }) {
  return (
    <div className="modal-tpl-area">
      {showSaveTpl ? (
        <>
          <div className="field u-mb8">
            <label className="field-lbl">Название шаблона *</label>
            <input className="field-inp" placeholder="Например: Гость Иван, Сантехник..."
              value={tplName} onChange={e => setTplName(e.target.value)}
              autoFocus onKeyDown={e => e.key === 'Enter' && onSave()} />
          </div>
          <div className="u-row-g8-bare">
            <button className="btn-outline u-flex1" onClick={() => { setShowSaveTpl(false); setTplName(''); }}>Отмена</button>
            <button className="btn-gold u-flex2" onClick={onSave}><span>💾 Сохранить шаблон</span></button>
          </div>
        </>
      ) : (
        <button className="tpl-save-btn" onClick={() => setShowSaveTpl(true)}>💾 Сохранить как шаблон</button>
      )}
    </div>
  );
});

// ─── ScheduleSection ──────────────────────────────────────────────────────────

// FIX [PERF-19]: memo — ScheduleSection рендерится при каждом keystroke
const ScheduleSection = memo(function ScheduleSection({ showSchedule, setShowSchedule, scheduledFor, setScheduledFor, applyPreset }) {
  // FIX [PERF-13]: minDateTime() вызывался на каждый рендер даже когда секция закрыта.
  // Теперь пересчитывается только при открытии секции (showSchedule изменился на true).
  // Нет смысла в useMemo — значение нужно свежим в момент клика, не кешированным.
  const handleToggle = () => {
    const opening = !showSchedule;
    setShowSchedule(o => !o);
    if (opening && !scheduledFor) setScheduledFor(minDateTime());
  };
  const minDT = showSchedule ? minDateTime() : '';

  return (
    <div className="u-p-schedule">
      <button className={'schedule-toggle' + (showSchedule ? ' active' : '')}
        onClick={handleToggle}>
        <span className="u-row-g8">
          <span className="schedule-toggle-ico">🕐</span>
          <span>{showSchedule && scheduledFor ? 'Запланировано: ' + fmtScheduled(scheduledFor) : 'Запланировать на время'}</span>
        </span>
        <span className="u-fs11-op6">{showSchedule ? '✕' : '+'}</span>
      </button>
      {showSchedule && (
        <div className="schedule-block">
          <label>Дата и время отправки</label>
          <input type="datetime-local" className="schedule-datetime"
            value={scheduledFor} min={minDT} onChange={e => setScheduledFor(e.target.value)} />
          <div className="schedule-presets">
            {SCHEDULE_PRESETS.map((p, i) => (
              <button key={p.label} className="schedule-preset" onClick={() => applyPreset(p)}>{p.label}</button>
            ))}
          </div>
          {scheduledFor && (
            <div className="schedule-info">
              <span>🔔</span>
              <span>Заявка будет отправлена охране {fmtScheduled(scheduledFor)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// ─── CreateModal ──────────────────────────────────────────────────────────────

export function CreateModal({ user, type, initialCat, initialData, onClose, onDone }) {
  const form = useCreateRequest({ user, type, initialCat, initialData, onClose, onDone });
  const submitLabel = form.loading             ? 'Сохранение...'
    : form.showSchedule && form.scheduledFor   ? 'Запланировать'
    : 'Создать заявку';

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-handle" />
        <div className="modal-head">
          <div>
            <span className="modal-title">{type === 'pass' ? 'Новый пропуск' : 'Вызов техслужбы'}</span>
            <div style={{ fontSize: 11, color: 'var(--t4)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="u-op7">{CAT_ICON[form.cat]}</span>
              <span className="u-ls3">{CAT_LABEL[form.cat]}</span>
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>

        <div className="modal-body">
          {type === 'pass' && (
            <VisitorFields
              cat={form.cat}
              vName={form.vName}           setVName={form.setVName}
              vNames={form.vNames}         setVNames={form.setVNames}
              vPhone={form.vPhone}         setVPhone={form.setVPhone}
              carPlate={form.carPlate}     setCarPlate={form.setCarPlate}
              permsList={form.permsList}
              showPermsPicker={form.showPermsPicker}
              setShowPermsPicker={form.setShowPermsPicker}
              onPickPerm={form.handlePickPerm}
            />
          )}
          {type === 'pass' && ['guest', 'car', 'worker', 'team'].includes(form.cat) && (
            <div className="field">
              {!form.validUntil ? (
                <button type="button" className="temp-pass-toggle" onClick={() => form.setValidUntil(
                  toLocalDateInputValue(new Date(Date.now() + 7 * 86400000))
                )}>
                  <span>📅</span>
                  <span>Временный пропуск</span>
                </button>
              ) : (
                <div className="temp-pass-block">
                  <div className="temp-pass-header">
                    <span className="temp-pass-label">📅 Временный пропуск</span>
                    <button type="button" className="temp-pass-close" onClick={() => form.setValidUntil('')}>✕ Убрать</button>
                  </div>
                  <label className="field-lbl">Действует до</label>
                  <input type="date" className="field-inp"
                    value={form.validUntil}
                    min={toLocalDateInputValue(new Date())}
                    onChange={e => form.setValidUntil(e.target.value)}
                    autoFocus />
                  <div className="temp-pass-presets">
                    {[
                      ['3 дня', 3], ['Неделя', 7], ['2 недели', 14], ['Месяц', 30],
                    ].map(([label, days]) => (
                      <button key={days} type="button" className="temp-pass-preset"
                        onClick={() => form.setValidUntil(
                          toLocalDateInputValue(new Date(Date.now() + days * 86400000))
                        )}>{label}</button>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--t4)', marginTop: 6 }}>
                    Многоразовый вход до {parseLocalDateInputValue(form.validUntil)?.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="field">
            <label className="field-lbl">Комментарий</label>
            <textarea className="field-textarea" rows={3} placeholder="Дополнительно..."
              value={form.comment} onChange={e => form.setComment(e.target.value)} />
          </div>
          <label className="photo-btn" style={{ flexDirection: 'column', gap: 6 }}>
            <span className="u-row-g8">📷 <span>{form.photos.length > 0 ? `Фото: ${form.photos.length}/5` : 'Прикрепить фото'}</span></span>
            <input type="file" accept="image/*" multiple className="u-none" onChange={form.handlePhoto} />
          </label>
          {form.photos.length > 0 && (
            <div className="photo-grid">
              {form.photos.map((src, i) => (
                // FIX [BUG-18]: src.slice(-12)+i нестабилен если URL перезаписывается.
                // key=index безопасен: фото только добавляются/удаляются, не переставляются.
                <div key={i} className="photo-grid-item">
                  <img src={src} alt="" />
                  <button type="button" className="photo-grid-del" onClick={() => form.removePhoto(i)}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <TemplateSection
          showSaveTpl={form.showSaveTpl}   setShowSaveTpl={form.setShowSaveTpl}
          tplName={form.tplName}            setTplName={form.setTplName}
          onSave={form.handleSaveTpl}
        />
        <ScheduleSection
          showSchedule={form.showSchedule}   setShowSchedule={form.setShowSchedule}
          scheduledFor={form.scheduledFor}   setScheduledFor={form.setScheduledFor}
          applyPreset={form.applyPreset}
        />
        <div className="modal-foot">
          <button className="btn-outline" onClick={onClose}>Отмена</button>
          <button className="btn-gold u-flex2" onClick={form.handleSubmit} disabled={form.loading}>
            <span>{submitLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
