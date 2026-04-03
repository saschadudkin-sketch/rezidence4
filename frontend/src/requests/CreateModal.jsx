import { memo } from 'react';
import { CAT_ICON, CAT_LABEL } from '../constants/index.js';
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
import { AppIcon } from '../ui/AppIcon.jsx';

// ─── VisitorFields ────────────────────────────────────────────────────────────
// FIX [PERF-19]: memo — VisitorFields не имеет внутреннего состояния, рендерится
// при каждом keystroke в форме CreateModal. Мемоизация экономит перерасчёт
// всех условных блоков (needsCarPlate, hasVisitorFields, permsList и т.д.)
const VisitorFields = memo(function VisitorFields({ cat, vName, setVName, vNames, setVNames, vPhone, setVPhone,
  carPlate, setCarPlate, permsList, showPermsPicker, setShowPermsPicker, onPickPerm }) {
  return (
    <>
      {/* CQ-02: unified car plate field — required for taxi, optional for others */}
      {needsCarPlate(cat) && (
        <div className="field">
          <label className="field-lbl">Марка и номер авто{cat === 'taxi' ? ' *' : ''}</label>
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
            <div key={n.__id ?? i} className="vf-name-row">
              <input className="field-inp vf-name-inp"
                placeholder={'Посетитель ' + (i + 1)} value={typeof n === 'object' ? n.value : n}
                onChange={e => {
                  const a = [...vNames];
                  a[i] = typeof n === 'object' ? { ...n, value: e.target.value } : e.target.value;
                  setVNames(a);
                }}
                autoCapitalize="words" />
              {vNames.length > 1 && (
                <button type="button" className="vf-name-del" onClick={() => setVNames(vNames.filter((_, j) => j !== i))}><AppIcon name="close" size={12} /></button>
              )}
            </div>
          ))}
          <button type="button" className="vf-add-btn" onClick={() => setVNames([...vNames, ''])}>
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
            <div className="perms-picker-wrap">
              <button type="button" className="perms-picker-trigger" onClick={() => setShowPermsPicker(p => !p)}>
                <span className="u-inline-icon"><AppIcon name="list" size={12} /> Выбрать из постоянного списка ({permsList.length})</span>
              </button>
              {showPermsPicker && (
                <div className="perms-picker-dropdown">
                  {permsList.map(p => (
                    <button key={p.id} type="button" className="perms-picker-item" onClick={() => onPickPerm(p)}>
                      <span className="perms-picker-item-name">{p.name}</span>
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
            <button className="btn-gold u-flex2" onClick={onSave}><span className="u-inline-icon"><AppIcon name="file" size={14} /> Сохранить шаблон</span></button>
          </div>
        </>
      ) : (
        <button className="tpl-save-btn" onClick={() => setShowSaveTpl(true)}><span className="u-inline-icon"><AppIcon name="file" size={14} /> Сохранить как шаблон</span></button>
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
          <span className="schedule-toggle-ico"><AppIcon name="history" size={14} /></span>
          <span>{showSchedule && scheduledFor ? 'Запланировано: ' + fmtScheduled(scheduledFor) : 'Запланировать на время'}</span>
        </span>
        <span className="u-fs11-op6">{showSchedule ? '−' : '+'}</span>
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
              <span><AppIcon name="chart" size={12} /></span>
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
            <div className="modal-cat-hint">
              <span className="u-op7"><AppIcon name={CAT_ICON[form.cat] || 'users'} size={12} /></span>
              <span className="u-ls3">{CAT_LABEL[form.cat]}</span>
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть"><AppIcon name="close" size={14} /></button>
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
                  <span><AppIcon name="history" size={14} /></span>
                  <span>Временный пропуск</span>
                </button>
              ) : (
                <div className="temp-pass-block">
                  <div className="temp-pass-header">
                    <span className="temp-pass-label"><AppIcon name="history" size={12} /> Временный пропуск</span>
                    <button type="button" className="temp-pass-close" onClick={() => form.setValidUntil('')}><AppIcon name="close" size={12} /> Убрать</button>
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
                  <div className="temp-pass-info">
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
          <label className="photo-btn photo-btn--col">
            <span className="u-row-g8"><AppIcon name="camera" size={14} /> <span>{form.photos.length > 0 ? `Фото: ${form.photos.length}/5` : 'Прикрепить фото'}</span></span>
            <input type="file" accept="image/*" multiple className="u-none" onChange={form.handlePhoto} />
          </label>
          {form.photos.length > 0 && (
            <div className="photo-grid">
              {form.photos.map((src, i) => (
                // FIX [BUG-18]: src.slice(-12)+i нестабилен если URL перезаписывается.
                // key=index безопасен: фото только добавляются/удаляются, не переставляются.
                <div key={i} className="photo-grid-item">
                  <img src={src} alt="" />
                  <button type="button" className="photo-grid-del" onClick={() => form.removePhoto(i)}><AppIcon name="close" size={12} /></button>
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
