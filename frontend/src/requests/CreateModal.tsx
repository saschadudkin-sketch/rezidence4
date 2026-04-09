import { memo, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { genId } from '../utils';
import { CAT_ICON, CAT_LABEL } from '../constants/index';
import { MAX_PHOTOS_PER_REQUEST, daysFromNow } from '../constants/limits';
import {
  useCreateRequest,
  hasVisitorFields,
  needsCarPlate,
  requiresVisitorName,
} from '../hooks/useCreateRequest';
import { toLocalDateInputValue, parseLocalDateInputValue } from '../utils/dateInput';
import { fmtScheduled, minDateTime, SCHEDULE_PRESETS } from '../hooks/useScheduleForm';
import { AppIcon } from '../ui/AppIcon';
import { useModalAccessibility } from '../ui/useModalAccessibility';
import { sanitizeCarPlate, sanitizePhone, sanitizeText } from '../utils/inputSanitizer';
import type { AppUser } from '../store/slices/usersSlice';
import type { RequestType } from '../store/slices/requestsSlice';

type VisitorNameEntry = { __id: string; value: string };
type PermEntry = { id: string; name: string; phone?: string };
type TemplateSectionProps = {
  showSaveTpl: boolean;
  setShowSaveTpl: Dispatch<SetStateAction<boolean>>;
  tplName: string;
  setTplName: Dispatch<SetStateAction<string>>;
  onSave: () => void;
};
type SchedulePreset = (typeof SCHEDULE_PRESETS)[number];
type ScheduleSectionProps = {
  showSchedule: boolean;
  setShowSchedule: Dispatch<SetStateAction<boolean>>;
  scheduledFor: string;
  setScheduledFor: Dispatch<SetStateAction<string>>;
  applyPreset: (preset: SchedulePreset) => void;
};
type AccordionSectionProps = {
  title: string;
  subtitle?: string;
  icon: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  badge?: ReactNode;
};
type VisitorFieldsProps = {
  cat: string;
  vName: string;
  setVName: Dispatch<SetStateAction<string>>;
  vNames: VisitorNameEntry[];
  setVNames: Dispatch<SetStateAction<VisitorNameEntry[]>>;
  vPhone: string;
  setVPhone: Dispatch<SetStateAction<string>>;
  carPlate: string;
  setCarPlate: Dispatch<SetStateAction<string>>;
  permsList: PermEntry[];
  showPermsPicker: boolean;
  setShowPermsPicker: Dispatch<SetStateAction<boolean>>;
  onPickPerm: (perm: PermEntry) => void;
};
type TemporaryPassSectionProps = {
  validUntil: string;
  setValidUntil: Dispatch<SetStateAction<string>>;
};
type PhotoSectionProps = {
  photos: string[];
  handlePhoto: (event: React.ChangeEvent<HTMLInputElement>) => void;
  removePhoto: (index: number) => void;
};
type CreateModalProps = {
  user: AppUser;
  type: RequestType;
  initialCat?: string;
  initialData?: Record<string, unknown>;
  onClose: () => void;
  onDone: () => void;
};

const VisitorFields = memo(function VisitorFields({
  cat,
  vName,
  setVName,
  vNames,
  setVNames,
  vPhone,
  setVPhone,
  carPlate,
  setCarPlate,
  permsList,
  showPermsPicker,
  setShowPermsPicker,
  onPickPerm,
}: VisitorFieldsProps) {
  return (
    <>
      {needsCarPlate(cat) && (
        <div className="field">
          <label className="field-lbl">Марка и номер авто{cat === 'taxi' ? ' *' : ''}</label>
          <input
            className="field-inp"
            placeholder="Toyota Camry А123БВ777"
            value={carPlate}
            onChange={(e) => setCarPlate(e.target.value)}
            onBlur={(e) => setCarPlate(sanitizeCarPlate(e.target.value))}
            autoCapitalize="characters"
          />
        </div>
      )}

      {cat === 'team' && (
        <div className="field">
          <label className="field-lbl">Имена посетителей *</label>
          {vNames.map((n, i) => (
            <div key={n.__id} className="vf-name-row">
              <input
                className="field-inp vf-name-inp"
                placeholder={`Посетитель ${i + 1}`}
                value={n.value}
                onChange={(e) => {
                  const next = [...vNames];
                  next[i] = { ...n, value: e.target.value };
                  setVNames(next);
                }}
                onBlur={(e) => {
                  const next = [...vNames];
                  next[i] = { ...n, value: sanitizeText(e.target.value) };
                  setVNames(next);
                }}
                autoCapitalize="words"
              />
              {vNames.length > 1 && (
                <button type="button" className="vf-name-del" onClick={() => setVNames(vNames.filter((_, j) => j !== i))}>
                  <AppIcon name="close" size={12} />
                </button>
              )}
            </div>
          ))}
          <button type="button" className="vf-add-btn" onClick={() => setVNames([...vNames, { __id: genId(), value: '' }])}>
            + Добавить посетителя
          </button>
        </div>
      )}

      {hasVisitorFields(cat) && (
        <div className="field">
          <label className="field-lbl">{requiresVisitorName(cat) ? 'Имя посетителя *' : 'Имя посетителя'}</label>
          <input
            className="field-inp"
            placeholder="Иван Иванов"
            value={vName}
            onChange={(e) => setVName(e.target.value)}
            onBlur={(e) => setVName(sanitizeText(e.target.value))}
            autoCapitalize="words"
            autoComplete="name"
          />
          {permsList.length > 0 && (
            <div className="perms-picker-wrap">
              <button type="button" className="perms-picker-trigger" onClick={() => setShowPermsPicker((value) => !value)}>
                <span className="u-inline-icon"><AppIcon name="file" size={12} /> Выбрать из постоянного списка ({permsList.length})</span>
              </button>
              {showPermsPicker && (
                <div className="perms-picker-dropdown">
                  {permsList.map((perm) => (
                    <button key={perm.id} type="button" className="perms-picker-item" onClick={() => onPickPerm(perm)}>
                      <span className="perms-picker-item-name">{perm.name}</span>
                      {perm.phone && <span className="u-fs11-t4">{perm.phone}</span>}
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
          <input
            className="field-inp"
            placeholder="+7 000 000-00-00"
            type="tel"
            value={vPhone}
            onChange={(e) => setVPhone(e.target.value)}
            onBlur={(e) => setVPhone(sanitizePhone(e.target.value))}
            inputMode="tel"
            autoComplete="tel"
          />
        </div>
      )}
    </>
  );
});

const TemplateSection = memo(function TemplateSection({ showSaveTpl, setShowSaveTpl, tplName, setTplName, onSave }: TemplateSectionProps) {
  return (
    <div className="modal-tpl-area">
      {showSaveTpl ? (
        <>
          <div className="field u-mb8">
            <label className="field-lbl">Название шаблона *</label>
            <input
              className="field-inp"
              placeholder="Например: Гость Иван, Сантехник..."
              value={tplName}
              onChange={(e) => setTplName(e.target.value)}
              onBlur={(e) => setTplName(sanitizeText(e.target.value))}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && onSave()}
            />
          </div>
          <div className="u-row-g8-bare">
            <button className="btn-outline u-flex1" onClick={() => { setShowSaveTpl(false); setTplName(''); }}>Отмена</button>
            <button className="btn-gold u-flex2" onClick={onSave}>
              <span className="u-inline-icon"><AppIcon name="file" size={14} /> Сохранить шаблон</span>
            </button>
          </div>
        </>
      ) : (
        <button className="tpl-save-btn" onClick={() => setShowSaveTpl(true)}>
          <span className="u-inline-icon"><AppIcon name="file" size={14} /> Сохранить как шаблон</span>
        </button>
      )}
    </div>
  );
});

const ScheduleSection = memo(function ScheduleSection({ showSchedule, setShowSchedule, scheduledFor, setScheduledFor, applyPreset }: ScheduleSectionProps) {
  const handleToggle = () => {
    const opening = !showSchedule;
    setShowSchedule((value) => !value);
    if (opening && !scheduledFor) setScheduledFor(minDateTime());
  };
  const minDT = showSchedule ? minDateTime() : '';

  return (
    <div className="u-p-schedule">
      <button className={'schedule-toggle' + (showSchedule ? ' active' : '')} onClick={handleToggle} type="button">
        <span className="u-row-g8">
          <span className="schedule-toggle-ico"><AppIcon name="clock" size={14} /></span>
          <span>{showSchedule && scheduledFor ? 'Запланировано: ' + fmtScheduled(scheduledFor) : 'Запланировать на время'}</span>
        </span>
        <span className="u-fs11-op6"><AppIcon name={showSchedule ? 'chevron-up' : 'chevron-down'} size={12} /></span>
      </button>
      {showSchedule && (
        <div className="schedule-block">
          <label>Дата и время отправки</label>
          <input type="datetime-local" className="schedule-datetime" value={scheduledFor} min={minDT} onChange={(e) => setScheduledFor(e.target.value)} />
          <div className="schedule-presets">
            {SCHEDULE_PRESETS.map((preset) => (
              <button key={preset.label} className="schedule-preset" onClick={() => applyPreset(preset)}>{preset.label}</button>
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

const AccordionSection = memo(function AccordionSection({ title, subtitle, icon, open, onToggle, children, badge }: AccordionSectionProps) {
  return (
    <div className="u-p-schedule">
      <button className={'schedule-toggle' + (open ? ' active' : '') + (badge ? ' schedule-toggle--has-badge' : '')} onClick={onToggle} type="button">
        {badge ? <span className="schedule-toggle-badge">{badge}</span> : null}
        <span className="u-row-g8">
          <span className="schedule-toggle-ico"><AppIcon name={icon} size={14} /></span>
          <span>
            {title}
            {subtitle ? <span className="u-fs11-op6"> {' - '}{subtitle}</span> : null}
          </span>
        </span>
        <span className="u-row-g8">
          <span className="u-fs11-op6"><AppIcon name={open ? 'chevron-up' : 'chevron-down'} size={12} /></span>
        </span>
      </button>
      {open && <div className="schedule-block">{children}</div>}
    </div>
  );
});

function TemporaryPassSection({ validUntil, setValidUntil }: TemporaryPassSectionProps) {
  const [open, setOpen] = useState(false);

  if (!validUntil) {
    return (
      <button
        type="button"
        className="temp-pass-toggle"
        onClick={() => {
          setValidUntil(toLocalDateInputValue(daysFromNow(7)));
          setOpen(true);
        }}
      >
        <span><AppIcon name="clock" size={14} /></span>
        <span>Временный пропуск</span>
      </button>
    );
  }

  if (!open) {
    return (
      <div className="temp-pass-summary">
        <button type="button" className="temp-pass-summary-main" onClick={() => setOpen(true)}>
          <span className="temp-pass-label"><AppIcon name="clock" size={12} /> Временный пропуск</span>
          <span className="temp-pass-summary-date">
            до {parseLocalDateInputValue(validUntil)?.toLocaleDateString('ru-RU')}
          </span>
        </button>
        <button type="button" className="temp-pass-summary-remove" onClick={() => setValidUntil('')}>
          <AppIcon name="close" size={12} />
        </button>
      </div>
    );
  }

  return (
    <div className="temp-pass-block">
      <div className="temp-pass-header">
        <button type="button" className="temp-pass-label temp-pass-label-btn" onClick={() => setOpen((value) => !value)}>
          <AppIcon name="clock" size={12} /> Временный пропуск <AppIcon name={open ? 'chevron-up' : 'chevron-down'} size={12} />
        </button>
        <span className="temp-pass-actions">
          <button type="button" className="temp-pass-close" onClick={() => setValidUntil('')}>
            <AppIcon name="close" size={12} /> Убрать
          </button>
        </span>
      </div>
      <label className="field-lbl">Действует до</label>
      <input
        type="date"
        className="field-inp"
        value={validUntil}
        min={toLocalDateInputValue(new Date())}
        onChange={(e) => setValidUntil(e.target.value)}
      />
      <div className="temp-pass-presets">
        {[
          ['3 дня', 3],
          ['Неделя', 7],
          ['2 недели', 14],
          ['Месяц', 30],
        ].map(([label, days]: [string, number]) => (
          <button key={days} type="button" className="temp-pass-preset" onClick={() => setValidUntil(toLocalDateInputValue(daysFromNow(days)))}>
            {label}
          </button>
        ))}
      </div>
      <div className="temp-pass-info">
        Многоразовый вход до {parseLocalDateInputValue(validUntil)?.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
      </div>
    </div>
  );
}

function PhotoSection({ photos, handlePhoto, removePhoto }: PhotoSectionProps) {
  return (
    <>
      <label
        className={'photo-btn photo-btn--col' + (photos.length >= MAX_PHOTOS_PER_REQUEST ? ' disabled' : '')}
        aria-disabled={photos.length >= MAX_PHOTOS_PER_REQUEST}
        title={photos.length >= MAX_PHOTOS_PER_REQUEST ? `Максимум ${MAX_PHOTOS_PER_REQUEST} фотографий` : undefined}
      >
        <span className="u-row-g8">
          <AppIcon name="camera" size={14} />
          <span>{`Фото: ${photos.length}/${MAX_PHOTOS_PER_REQUEST}`}</span>
        </span>
        <input type="file" accept="image/*" multiple className="u-none" onChange={handlePhoto} disabled={photos.length >= MAX_PHOTOS_PER_REQUEST} />
      </label>
      {photos.length > 0 && (
        <div className="photo-grid">
          {photos.map((src, i) => (
            <div key={i} className="photo-grid-item">
              <img src={src} alt="" />
              <button type="button" className="photo-grid-del" onClick={() => removePhoto(i)}>
                <AppIcon name="close" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function CreateModal({ user, type, initialCat, initialData, onClose, onDone }: CreateModalProps) {
  const form = useCreateRequest({ user, type, initialCat, initialData, onClose, onDone });
  const cats = form.cats || [];
  const { dialogRef, overlayProps } = useModalAccessibility({ onClose });
  const [showAdvanced, setShowAdvanced] = useState(false);

  const submitLabel = form.loading
    ? 'Сохранение...'
    : form.showSchedule && form.scheduledFor
      ? 'Запланировать'
      : 'Создать заявку';

  const hasAdvancedSelection = Boolean(
    form.validUntil
    || form.comment.trim()
    || form.photos.length
    || (form.showSaveTpl && form.tplName.trim())
    || (form.showSchedule && form.scheduledFor)
  );

  const advancedSubtitle = '';

  return (
    <div className="overlay" {...overlayProps}>
      <div className="modal modal--request" ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1}>
        <div className="modal-handle" />
        <div className="modal-head">
          <div className="modal-head-main">
            <span className="modal-title">{type === 'pass' ? 'Новый пропуск' : 'Вызов техслужбы'}</span>
            <div className="modal-cat-hint">
              <span className="u-op7"><AppIcon name={CAT_ICON[form.cat] || 'users'} size={12} /></span>
              <span className="u-ls3">{CAT_LABEL[form.cat]}</span>
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть"><AppIcon name="close" size={14} /></button>
        </div>

        <div className="modal-body">
          <div className="u-fs11-op6 u-mb8">Шаг 1. Быстрое создание</div>

          {cats.length > 1 && (
            <div className="modal-cat-picker" role="group" aria-label="Тип заявки">
              {cats.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`modal-cat-btn${form.cat === cat ? ' active' : ''}`}
                  onClick={() => form.setCat(cat)}
                  aria-pressed={form.cat === cat}
                >
                  <span className="modal-cat-btn-ico"><AppIcon name={CAT_ICON[cat] || 'users'} size={14} /></span>
                  <span className="modal-cat-btn-label">{CAT_LABEL[cat]}</span>
                </button>
              ))}
            </div>
          )}

          {type === 'pass' && (
            <VisitorFields
              cat={form.cat}
              vName={form.vName}
              setVName={form.setVName}
              vNames={form.vNames}
              setVNames={form.setVNames}
              vPhone={form.vPhone}
              setVPhone={form.setVPhone}
              carPlate={form.carPlate}
              setCarPlate={form.setCarPlate}
              permsList={[...form.permsList]}
              showPermsPicker={form.showPermsPicker}
              setShowPermsPicker={form.setShowPermsPicker}
              onPickPerm={form.handlePickPerm}
            />
          )}

          <AccordionSection
            title="Шаг 2. Дополнительные настройки"
            subtitle={advancedSubtitle}
            icon="file"
            open={showAdvanced}
            onToggle={() => setShowAdvanced((value) => !value)}
            badge={hasAdvancedSelection ? <span className="vlog-tag ok">вкл</span> : null}
          >
            {type === 'pass' && ['guest', 'car', 'worker', 'team'].includes(form.cat) && (
              <div className="field">
                <TemporaryPassSection validUntil={form.validUntil} setValidUntil={form.setValidUntil} />
              </div>
            )}

            <div className="field">
              <label className="field-lbl">Комментарий</label>
              <textarea
                className="field-textarea"
                rows={3}
                placeholder="Дополнительно..."
                value={form.comment}
                onChange={(e) => form.setComment(e.target.value)}
                onBlur={(e) => form.setComment(sanitizeText(e.target.value))}
              />
            </div>

            <PhotoSection photos={form.photos} handlePhoto={form.handlePhoto} removePhoto={form.removePhoto} />

            <TemplateSection
              showSaveTpl={form.showSaveTpl}
              setShowSaveTpl={form.setShowSaveTpl}
              tplName={form.tplName}
              setTplName={form.setTplName}
              onSave={form.handleSaveTpl}
            />

            <ScheduleSection
              showSchedule={form.showSchedule}
              setShowSchedule={form.setShowSchedule}
              scheduledFor={form.scheduledFor}
              setScheduledFor={form.setScheduledFor}
              applyPreset={form.applyPreset}
            />
          </AccordionSection>
        </div>

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
