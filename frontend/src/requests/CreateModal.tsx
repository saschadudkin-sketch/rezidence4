import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { toLocalDateInputValue, parseLocalDateInputValue, toLocalDateTimeInputValue } from '../utils/dateInput';
import { fmtScheduled, minDateTime, SCHEDULE_PRESETS } from '../hooks/useScheduleForm';
import { AppIcon } from '../ui/AppIcon';
import { useModalAccessibility } from '../ui/useModalAccessibility';
import { sanitizeCarPlate, sanitizePhone, sanitizeText } from '../utils/inputSanitizer';
import { clearCreateDraft, getCreateDraftKey, loadCreateDraft, saveCreateDraft } from './createDraftStorage';
import type { AppUser } from '../store/slices/usersSlice';
import type { AppRequest, RequestType } from '../store/slices/requestsSlice';

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
  showApartmentField: boolean;
  apartment: string;
  setApartment: Dispatch<SetStateAction<string>>;
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
  initialStep?: number;
  initialFast?: boolean;
  onClose: () => void;
  onDone: (request?: AppRequest) => void;
};
type CreateRequestForm = ReturnType<typeof useCreateRequest>;
type CategoryKey = keyof typeof CAT_LABEL;

const COURIER_PRESETS = ['Ozon', 'Wildberries', 'Яндекс Доставка', 'СДЭК', 'Самокат'];

function getCategoryLabel(category: string): string {
  return category in CAT_LABEL ? CAT_LABEL[category as CategoryKey] : category;
}

function getCategoryIcon(category: string): string {
  return category in CAT_ICON ? CAT_ICON[category as CategoryKey] : 'users';
}

function clampResidentStep(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(3, Math.trunc(value)));
}

function getResidentQuickDate(mode: 'evening' | 'tomorrow') {
  const next = new Date();
  if (mode === 'evening') {
    next.setHours(19, 0, 0, 0);
    if (next <= new Date()) next.setDate(next.getDate() + 1);
    return next;
  }
  next.setDate(next.getDate() + 1);
  next.setHours(8, 0, 0, 0);
  return next;
}

function formatResidentQuickMeta(date: Date) {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  const sameDay =
    date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  const nextDay =
    date.getFullYear() === tomorrow.getFullYear()
    && date.getMonth() === tomorrow.getMonth()
    && date.getDate() === tomorrow.getDate();

  const dayLabel = sameDay
    ? 'Сегодня'
    : nextDay
      ? 'Завтра'
      : date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });

  const timeLabel = date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return `${dayLabel}, ${timeLabel}`;
}

const VisitorFields = memo(function VisitorFields({
  showApartmentField,
  apartment,
  setApartment,
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
  const usesMultiVisitorNames = cat === 'guest' || cat === 'team';
  const visitorLabel = cat === 'courier'
    ? 'Служба доставки или имя курьера *'
    : requiresVisitorName(cat) ? 'Имя посетителя *' : 'Имя посетителя';
  const visitorPlaceholder = cat === 'courier'
    ? 'СДЭК, Ozon, Яндекс Доставка'
    : 'Иван Иванов';

  return (
    <>
      {showApartmentField && (
        <div className="field">
          <label className="field-lbl" htmlFor="request-apartment">Для какого апартамента пропуск *</label>
          <input
            id="request-apartment"
            className="field-inp"
            placeholder="Например: 1203"
            value={apartment}
            onChange={(e) => setApartment(e.target.value)}
            onBlur={(e) => setApartment(sanitizeText(e.target.value))}
            inputMode="numeric"
            autoComplete="off"
          />
        </div>
      )}

      {needsCarPlate(cat) && cat !== 'guest' && (
        <div className="field">
          <label className="field-lbl">Марка и номер авто{['taxi', 'car'].includes(cat) ? ' *' : ''}</label>
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

      {usesMultiVisitorNames && (
        <div className="field">
          <label className="field-lbl">Имена посетителей *</label>
          {vNames.map((n, i) => (
            <div key={n.__id} className="vf-name-row">
              <input
                className="field-inp vf-name-inp"
                placeholder={i === 0 ? 'Иван Иванов' : `Посетитель ${i + 1}`}
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
                <button type="button" className="vf-name-del" onClick={() => setVNames(vNames.filter((_, j) => j !== i))} aria-label={`Удалить посетителя ${i + 1}`}>
                  <AppIcon name="close" size={12} />
                </button>
              )}
            </div>
          ))}
          <button type="button" className="vf-add-btn" onClick={() => setVNames([...vNames, { __id: genId(), value: '' }])}>
            + Добавить посетителя
          </button>
          {cat === 'guest' && permsList.length > 0 && (
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

      {hasVisitorFields(cat) && !usesMultiVisitorNames && (
        <div className="field">
          <label className="field-lbl">{visitorLabel}</label>
          <input
            className="field-inp"
            placeholder={visitorPlaceholder}
            value={vName}
            onChange={(e) => setVName(e.target.value)}
            onBlur={(e) => setVName(sanitizeText(e.target.value))}
            autoCapitalize="words"
            autoComplete="name"
          />
          {cat === 'courier' && (
            <div className="courier-preset-chips" aria-label="Быстрый выбор службы доставки">
              {COURIER_PRESETS.map((name) => (
                <button key={name} type="button" className="courier-preset-chip" onClick={() => setVName(name)}>
                  {name}
                </button>
              ))}
            </div>
          )}
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

      {needsCarPlate(cat) && cat === 'guest' && (
        <div className="field">
          <label className="field-lbl">Марка и номер авто</label>
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
              <button type="button" className="photo-grid-del" onClick={() => removePhoto(i)} aria-label={`Удалить фото ${i + 1}`}>
                <AppIcon name="close" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function getResidentPassSummary(form: CreateRequestForm) {
  const names = form.vNames.map((item: VisitorNameEntry) => item.value.trim()).filter(Boolean);
  const visitor = names.length > 0 ? names.join(', ') : form.vName.trim();
  const who = visitor || form.carPlate.trim() || getCategoryLabel(form.cat) || 'Гость';
  const when = form.showSchedule && form.scheduledFor
    ? fmtScheduled(form.scheduledFor)
    : 'сразу после создания';
  const car = form.carPlate.trim();
  const apartment = form.apartment.trim();
  return { who, when, car, apartment };
}

function getResidentStepError(form: CreateRequestForm, step: number, userRole: AppUser['role']) {
  if (step !== 1) return '';
  if (userRole === 'concierge' && !form.apartment.trim()) return 'Укажите апартамент, для которого оформляется пропуск.';
  const carPlate = form.carPlate.trim();
  const visitorName = form.vName.trim();
  const visitorNames = form.vNames.map((item: VisitorNameEntry) => item.value.trim()).filter(Boolean);

  if (['taxi', 'car'].includes(form.cat) && !carPlate) return 'Укажите марку и номер авто, чтобы охрана быстро сверила машину.';
  if (['guest', 'team'].includes(form.cat) && visitorNames.length === 0) return 'Укажите имя хотя бы одного посетителя.';
  if (form.cat !== 'guest' && requiresVisitorName(form.cat) && !visitorName) {
    return form.cat === 'courier'
      ? 'Укажите службу доставки или имя курьера.'
      : 'Укажите имя посетителя.';
  }
  return '';
}

function ResidentPassWizard({
  form,
  cats,
  step,
  fastMode,
  userRole,
  residentError,
  showAdvanced,
  setShowAdvanced,
}: {
  form: CreateRequestForm;
  cats: string[];
  step: number;
  fastMode: boolean;
  userRole: AppUser['role'];
  residentError: string;
  showAdvanced: boolean;
  setShowAdvanced: Dispatch<SetStateAction<boolean>>;
}) {
  const summary = getResidentPassSummary(form);
  const eveningDate = getResidentQuickDate('evening');
  const tomorrowDate = getResidentQuickDate('tomorrow');
  const eveningValue = toLocalDateTimeInputValue(eveningDate);
  const tomorrowValue = toLocalDateTimeInputValue(tomorrowDate);
  const activeQuickTime = !form.showSchedule
    ? 'now'
    : form.scheduledFor === eveningValue
      ? 'evening'
      : form.scheduledFor === tomorrowValue
        ? 'tomorrow'
        : 'custom';
  const selectedQuickTimeLabel = activeQuickTime === 'now'
    ? 'Сейчас'
    : activeQuickTime === 'evening'
      ? `Вечером, ${formatResidentQuickMeta(eveningDate)}`
      : activeQuickTime === 'tomorrow'
        ? `Завтра утром, ${formatResidentQuickMeta(tomorrowDate)}`
        : form.showSchedule && form.scheduledFor
          ? fmtScheduled(form.scheduledFor)
          : '';
  const setQuickTime = (mode: 'now' | 'evening' | 'tomorrow') => {
    if (mode === 'now') {
      form.setShowSchedule(false);
      form.setScheduledFor('');
      return;
    }
    const next = mode === 'evening' ? eveningDate : tomorrowDate;
    form.setScheduledFor(toLocalDateTimeInputValue(next));
    form.setShowSchedule(true);
  };

  return (
    <div className="resident-wizard">
      {!fastMode && (
        <div className="resident-wizard-progress" aria-label={`Шаг ${step + 1} из 4`}>
          {['Тип', 'Гость', 'Время', 'Готово'].map((label, index) => (
            <span key={label} className={index <= step ? 'active' : ''}>
              {label}
            </span>
          ))}
        </div>
      )}

      {step === 0 && (
        <section className="resident-wizard-step">
          <div className="resident-wizard-copy">
            <h3>Кто к вам приедет?</h3>
            <p>Выберите сценарий, а мы покажем только нужные поля.</p>
          </div>
          <div className="resident-wizard-cats" role="group" aria-label="Тип пропуска">
            {cats.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`resident-wizard-cat${form.cat === cat ? ' active' : ''}`}
                onClick={() => form.setCat(cat)}
                aria-pressed={form.cat === cat}
              >
                <span><AppIcon name={getCategoryIcon(cat)} size={18} /></span>
                <strong>{getCategoryLabel(cat)}</strong>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="resident-wizard-step">
          <div className="resident-wizard-copy">
            <h3>{fastMode ? 'Заполните пропуск' : 'Кого ждёте?'}</h3>
            <p>{fastMode ? 'Минимум данных — и охрана сразу увидит пропуск.' : 'Можно выбрать из постоянного списка или ввести данные вручную.'}</p>
          </div>
          <VisitorFields
            showApartmentField={userRole === 'concierge'}
            apartment={form.apartment}
            setApartment={form.setApartment}
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
          {residentError && (
            <div className="field-err resident-step-error" role="alert" aria-live="polite">
              {residentError}
            </div>
          )}
        </section>
      )}

      {step === 2 && (
        <section className="resident-wizard-step">
          <div className="resident-wizard-copy">
            <h3>Когда пропустить?</h3>
            <p>Для срочного визита оставьте “Сейчас”. Детали можно добавить ниже.</p>
          </div>
          <div className="resident-time-grid">
            <button type="button" className={activeQuickTime === 'now' ? 'active' : ''} onClick={() => setQuickTime('now')} aria-pressed={activeQuickTime === 'now'}>
              <span className="resident-time-label">Сейчас</span>
            </button>
            <button type="button" className={activeQuickTime === 'evening' ? 'active' : ''} onClick={() => setQuickTime('evening')} aria-pressed={activeQuickTime === 'evening'}>
              <span className="resident-time-label">Вечером</span>
              <span className="resident-time-meta">{formatResidentQuickMeta(eveningDate)}</span>
            </button>
            <button type="button" className={activeQuickTime === 'tomorrow' ? 'active' : ''} onClick={() => setQuickTime('tomorrow')} aria-pressed={activeQuickTime === 'tomorrow'}>
              <span className="resident-time-label">Завтра утром</span>
              <span className="resident-time-meta">{formatResidentQuickMeta(tomorrowDate)}</span>
            </button>
          </div>
          {selectedQuickTimeLabel && (
            <div className="resident-time-selected" aria-live="polite">
              Выбрано: {selectedQuickTimeLabel}
            </div>
          )}
          <AccordionSection
            title="Точное время и детали"
            icon="clock"
            open={showAdvanced}
            onToggle={() => setShowAdvanced((value) => !value)}
          >
            <ScheduleSection
              showSchedule={form.showSchedule}
              setShowSchedule={form.setShowSchedule}
              scheduledFor={form.scheduledFor}
              setScheduledFor={form.setScheduledFor}
              applyPreset={form.applyPreset}
            />
            {['guest', 'car', 'worker', 'team'].includes(form.cat) && (
              <div className="field">
                <TemporaryPassSection validUntil={form.validUntil} setValidUntil={form.setValidUntil} />
              </div>
            )}
            <div className="field">
              <label className="field-lbl">Комментарий для охраны</label>
              <textarea
                className="field-textarea"
                rows={3}
                placeholder="Например: встретить у КПП, позвонить перед проходом"
                value={form.comment}
                onChange={(e) => form.setComment(e.target.value)}
                onBlur={(e) => form.setComment(sanitizeText(e.target.value))}
              />
            </div>
            <PhotoSection photos={form.photos} handlePhoto={form.handlePhoto} removePhoto={form.removePhoto} />
          </AccordionSection>
        </section>
      )}

      {step === 3 && (
        <section className="resident-wizard-step">
          <div className="resident-wizard-copy">
            <h3>Проверьте пропуск</h3>
            <p>После создания охрана увидит его в своей очереди.</p>
          </div>
          <div className="resident-review-card">
            <div>
              <span>Тип</span>
              <strong>{getCategoryLabel(form.cat)}</strong>
            </div>
            <div>
              <span>Кому</span>
              <strong>{summary.who}</strong>
            </div>
            {summary.apartment && (
              <div>
                <span>Апартамент</span>
                <strong>{summary.apartment}</strong>
              </div>
            )}
            <div>
              <span>Когда</span>
              <strong>{summary.when}</strong>
            </div>
            {summary.car && (
              <div>
                <span>Авто</span>
                <strong>{summary.car}</strong>
              </div>
            )}
          </div>
          <TemplateSection
            showSaveTpl={form.showSaveTpl}
            setShowSaveTpl={form.setShowSaveTpl}
            tplName={form.tplName}
            setTplName={form.setTplName}
            onSave={form.handleSaveTpl}
          />
        </section>
      )}
    </div>
  );
}

export function CreateModal({ user, type, initialCat, initialData, initialStep, initialFast = false, onClose, onDone }: CreateModalProps) {
  const draftKey = getCreateDraftKey(user.uid, user.role, type);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const form = useCreateRequest({
    user,
    type,
    initialCat,
    initialData,
    onClose,
    onDone,
    onSubmitted: () => clearCreateDraft(draftKey),
  });
  const cats = form.cats || [];
  const { dialogRef, overlayProps } = useModalAccessibility({ onClose });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const isResidentPass = type === 'pass' && user.role !== 'contractor';
  const [residentStep, setResidentStep] = useState(() => clampResidentStep(initialStep));
  const [residentError, setResidentError] = useState('');
  const fastMode = Boolean(isResidentPass && initialFast);

  useEffect(() => {
    if (initialData) {
      setDraftReady(true);
      return;
    }

    const draft = loadCreateDraft(draftKey);
    if (!draft) {
      setDraftReady(true);
      return;
    }

    form.setCat(draft.cat);
    form.setVName(draft.vName);
    form.setVNames(
      draft.vNames.length > 0
        ? draft.vNames.map((value) => ({ __id: genId(), value }))
        : [{ __id: genId(), value: '' }],
    );
    form.setVPhone(draft.vPhone);
    form.setCarPlate(draft.carPlate);
    form.setApartment(draft.apartment);
    form.setComment(draft.comment);
    form.setValidUntil(draft.validUntil);
    form.setShowSchedule(draft.showSchedule);
    form.setScheduledFor(draft.scheduledFor);
    setResidentStep(clampResidentStep(draft.residentStep));
    setShowAdvanced(Boolean(draft.showAdvanced));
    setDraftRestored(true);
    setDraftReady(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- restore once per modal open
  }, [draftKey, initialData]);

  useEffect(() => {
    if (!draftReady) return;
    saveCreateDraft(draftKey, {
      cat: form.cat,
      vName: form.vName,
      vNames: form.vNames.map((entry: VisitorNameEntry) => entry.value),
      vPhone: form.vPhone,
      carPlate: form.carPlate,
      apartment: form.apartment,
      comment: form.comment,
      validUntil: form.validUntil,
      showSchedule: form.showSchedule,
      scheduledFor: form.scheduledFor,
      residentStep,
      showAdvanced,
    });
  }, [
    draftKey,
    draftReady,
    form.apartment,
    form.carPlate,
    form.cat,
    form.comment,
    form.scheduledFor,
    form.showSchedule,
    form.vName,
    form.vNames,
    form.vPhone,
    form.validUntil,
    residentStep,
    showAdvanced,
  ]);

  useEffect(() => {
    if (!residentError) return;
    setResidentError('');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- vNames is the resident visitor field state; clearing the step error is UI-only
  }, [form.cat, form.vName, form.vNames, form.carPlate, form.apartment]);

  useLayoutEffect(() => {
    const resetScroll = () => {
      if (!bodyRef.current) return;
      bodyRef.current.scrollTop = 0;
      bodyRef.current.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    };

    const frame = window.requestAnimationFrame(resetScroll);
    const timeout = window.setTimeout(resetScroll, 60);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [draftReady, draftRestored, showAdvanced, type, initialCat]);

  const submitLabel = form.loading
    ? 'Сохранение...'
    : form.showSchedule && form.scheduledFor
      ? 'Запланировать'
      : type === 'pass' ? 'Создать пропуск' : 'Создать заявку';

  const hasAdvancedSelection = Boolean(
    form.validUntil
    || form.comment.trim()
    || form.photos.length
    || (form.showSaveTpl && form.tplName.trim())
    || (form.showSchedule && form.scheduledFor)
  );

  const advancedSubtitle = '';
  const goResidentNext = () => {
    const error = getResidentStepError(form, residentStep, user.role);
    if (error) {
      setResidentError(error);
      return;
    }
    setResidentError('');
    setResidentStep((step) => Math.min(3, step + 1));
  };
  const submitResidentNow = () => {
    const error = getResidentStepError(form, 1, user.role);
    if (error) {
      setResidentStep(1);
      setResidentError(error);
      return;
    }
    setResidentError('');
    form.handleSubmit();
  };

  return (
    <div className="overlay" {...overlayProps}>
      <div className={`modal modal--request${fastMode ? ' modal--resident-fast' : ''}`} ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1}>
        <div className="modal-handle" />
        <div className="modal-head">
          <div className="modal-head-main">
            <span className="modal-title">{type === 'pass' ? 'Новый пропуск' : 'Вызов техслужбы'}</span>
            <div className="modal-cat-hint">
              <span className="u-op7"><AppIcon name={getCategoryIcon(form.cat)} size={12} /></span>
              <span className="u-ls3">{getCategoryLabel(form.cat)}</span>
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть"><AppIcon name="close" size={14} /></button>
        </div>

        <div className="modal-body" ref={bodyRef}>
          {draftRestored && (
            <div className="field-warn" role="status" aria-live="polite">
              Восстановлен черновик последней незавершённой заявки.
            </div>
          )}
          {isResidentPass ? (
            <ResidentPassWizard
              form={form}
              cats={cats}
              step={residentStep}
              fastMode={fastMode}
              userRole={user.role}
              residentError={residentError}
              showAdvanced={showAdvanced}
              setShowAdvanced={setShowAdvanced}
            />
          ) : (
            <>
              <div className="u-fs11-op6 u-mb8">{type === 'pass' ? 'Шаг 1. Кого ждёте' : 'Шаг 1. Быстрое создание'}</div>

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
                      <span className="modal-cat-btn-ico"><AppIcon name={getCategoryIcon(cat)} size={14} /></span>
                      <span className="modal-cat-btn-label">{getCategoryLabel(cat)}</span>
                    </button>
                  ))}
                </div>
              )}

              {type === 'pass' && (
                <VisitorFields
                  showApartmentField={user.role === 'concierge'}
                  apartment={form.apartment}
                  setApartment={form.setApartment}
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
                title={type === 'pass' ? 'Шаг 2. Время, фото и детали' : 'Шаг 2. Дополнительные настройки'}
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
            </>
          )}
        </div>

        <div className="modal-foot">
          {isResidentPass ? (
            <>
              {fastMode && residentStep === 1 ? (
                <>
                  <button className="btn-outline" onClick={goResidentNext}>Время и детали</button>
                  <button className="btn-gold u-flex2" onClick={submitResidentNow} disabled={form.loading}>
                    <span>{form.loading ? 'Сохранение...' : 'Создать сейчас'}</span>
                  </button>
                </>
              ) : (
                <>
                  <button className="btn-outline" onClick={residentStep === 0 ? onClose : () => setResidentStep((step) => Math.max(0, step - 1))}>
                    {residentStep === 0 ? 'Отмена' : 'Назад'}
                  </button>
                  {residentStep < 3 ? (
                    <button className="btn-gold u-flex2" onClick={goResidentNext}>
                      <span>Продолжить</span>
                    </button>
                  ) : (
                    <button className="btn-gold u-flex2" onClick={submitResidentNow} disabled={form.loading}>
                      <span>{submitLabel}</span>
                    </button>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <button className="btn-outline" onClick={onClose}>Отмена</button>
              <button className="btn-gold u-flex2" onClick={form.handleSubmit} disabled={form.loading}>
                <span>{submitLabel}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
