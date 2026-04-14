import { memo, useCallback, useMemo } from 'react';
import { OperationalRequestList } from '../../requests/OperationalRequestList';
import { AppIcon } from '../../ui/AppIcon';
import StateBlock from '../../ui/StateBlock';
import SectionHeader from '../../ui/SectionHeader';
import { useDebounce } from '../../hooks/useDebounce';
import { getViewStateCopy } from '../../ui/viewStateContract';
import { useUrlSearchParams } from '../../hooks/useUrlSearchParams';
import type { AppRequest, RequestType } from '../../store/slices/requestsSlice';
import type { UserRole } from '../../store/slices/usersSlice';

const PASS_FILTER_PILLS: ReadonlyArray<readonly [string, string]> = [
  ['active', 'Активные'],
  ['scheduled', 'Запланированные'],
  ['all', 'Все'],
  ['temporary', 'Временные'],
  ['permanent', 'Постоянные'],
  ['once', 'Разовые'],
];

type PassesTabProps = {
  user: { role: UserRole | string; name: string; uid: string };
  passFilter: string;
  setPassFilter: (value: string) => void;
  setModal: (value: { type: RequestType; cat: string; initialStep?: number; fast?: boolean }) => void;
  onRepeatPass: (request: AppRequest) => void;
  onEdit: (request: AppRequest) => void;
  onDelete: (id: string) => void;
  onCancel: (id: string) => void;
  computed: {
    myPasses: AppRequest[];
    scheduledPasses: AppRequest[];
    filteredPasses: AppRequest[];
    tempCount: number;
    permCount: number;
  };
};

const PassesTab = memo(function PassesTab({
  user,
  passFilter,
  setPassFilter,
  setModal,
  onRepeatPass,
  onEdit,
  onDelete,
  onCancel,
  computed,
}: PassesTabProps) {
  const { myPasses, scheduledPasses, filteredPasses, tempCount, permCount } = computed;
  const scheduledCount = scheduledPasses.length;

  const [searchParams, setSearchParams] = useUrlSearchParams();
  const query = searchParams.get('passQ') || '';
  const debouncedQuery = useDebounce(query, 250);

  const updatePassSearch = useCallback((value: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value.trim()) next.delete('passQ');
    else next.set('passQ', value.trim());
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const matchQuery = useCallback((request: Record<string, unknown>) => {
    const normalizedQuery = debouncedQuery.trim().toLowerCase();
    if (!normalizedQuery) return true;

    return [request.visitorName, request.carPlate, request.comment].some((value) =>
      typeof value === 'string' && value.toLowerCase().includes(normalizedQuery),
    );
  }, [debouncedQuery]);

  const visiblePasses = useMemo(() => filteredPasses.filter(matchQuery), [filteredPasses, matchQuery]);
  const visibleScheduled = useMemo(() => scheduledPasses.filter(matchQuery), [scheduledPasses, matchQuery]);
  const passesEmptyCopy = getViewStateCopy('passes', 'empty');
  const isResidentExperience = user.role !== 'contractor';
  const activePasses = useMemo(
    () => myPasses.filter((request) => !['cancelled', 'rejected', 'expired', 'arrived'].includes(request.status)),
    [myPasses],
  );
  const recentRepeatPasses = useMemo(() => {
    const seen = new Set<string>();
    return myPasses
      .filter((request) => request.visitorName || request.carPlate)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .filter((request) => {
        const key = [request.category, request.visitorName, request.carPlate].filter(Boolean).join('|').toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 4);
  }, [myPasses]);

  const passIcons = user.role === 'contractor'
    ? [
        ['worker', 'tools', 'Рабочий'],
        ['team', 'users', 'Бригада'],
        ['delivery', 'car', 'Доставка'],
        ['car', 'car', 'Авто'],
      ]
    : [
        ['guest', 'users', 'Гость'],
        ['courier', 'courier', 'Курьер'],
        ['taxi', 'taxi', 'Такси'],
        ['car', 'car', 'Авто'],
        ['master', 'tools', 'Мастер'],
      ];

  const quickResidentActions = [
    ['guest', 'users', 'Гость', 'Близкие и приглашённые'],
    ['courier', 'courier', 'Курьер', 'Доставка к резиденции'],
    ['taxi', 'taxi', 'Такси', 'Въезд по номеру авто'],
  ];

  return (
    <div className={`passes-tab${user.role === 'contractor' ? ' passes-tab--contractor' : ' passes-tab--resident resident-pass-home'}`}>
      {isResidentExperience ? (
        <>
          <section className="resident-pass-hero" aria-label="Быстрое оформление пропуска">
            <div className="resident-pass-hero-copy">
              <div className="resident-pass-kicker">Пропуск за минуту</div>
              <h2>Кто к вам приедет?</h2>
              <p>Создайте пропуск, и охрана сразу увидит гостя, курьера или автомобиль.</p>
            </div>
            <button
              type="button"
              className="resident-primary-action"
              onClick={() => setModal({ type: 'pass', cat: 'guest' })}
            >
              <span className="resident-primary-icon"><AppIcon name="ticket" size={20} /></span>
              <span>
                <strong>Новый пропуск</strong>
                <small>Для гостя или семьи</small>
              </span>
            </button>
          </section>

          <div className="resident-quick-grid type-grid" aria-label="Быстрые варианты пропуска">
            {quickResidentActions.map(([key, iconName, label, hint]) => (
              <button
                key={key}
                type="button"
                className="resident-quick-card"
                aria-label={label as string}
                onClick={() => setModal({ type: 'pass', cat: key as string, initialStep: 1, fast: true })}
              >
                <span className="resident-quick-icon"><AppIcon name={iconName as string} size={18} /></span>
                <span className="resident-quick-copy">
                  <strong>{label}</strong>
                  <small>{hint}</small>
                </span>
              </button>
            ))}
          </div>

          {recentRepeatPasses.length > 0 && (
            <section className="resident-repeat-strip" aria-label="Повторить недавний пропуск">
              <div className="resident-section-head">
                <span>Позвать снова</span>
                <small>Последние пропуска</small>
              </div>
              <div className="resident-repeat-list">
                {recentRepeatPasses.map((request) => (
                  <button key={request.id} type="button" className="resident-repeat-chip" onClick={() => onRepeatPass(request)}>
                    <AppIcon name={request.carPlate ? 'car' : 'users'} size={14} />
                    <span>{request.visitorName || request.carPlate}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="resident-status-strip" aria-label="Текущие пропуска">
            <div>
              <strong>{activePasses.length}</strong>
              <span>активных или ожидающих пропусков</span>
            </div>
            <button type="button" className="btn-text" onClick={() => setPassFilter('active')}>
              Смотреть активные
            </button>
          </section>
        </>
      ) : (
        <>
          <section className="contractor-pass-hero" aria-label="Быстрое оформление рабочего пропуска">
            <div className="contractor-pass-hero-copy">
              <div className="resident-pass-kicker">Рабочий въезд без задержек</div>
              <h2>Кого оформить?</h2>
              <p>Выберите бригаду, доставку или служебный автомобиль и откройте въезд без звонков.</p>
            </div>
            <button
              type="button"
              className="resident-primary-action contractor-primary-action"
              onClick={() => setModal({ type: 'pass', cat: 'team' })}
            >
              <span className="resident-primary-icon"><AppIcon name="users" size={20} /></span>
              <span>
                <strong>Оформить въезд</strong>
                <small>Бригада, доставка, авто</small>
              </span>
            </button>
          </section>

          <div className="type-grid contractor-type-grid">
            {passIcons.map(([key, iconName, label]) => (
              <button
                key={key}
                type="button"
                className="type-card"
                onClick={() => setModal({ type: 'pass', cat: key as string })}
              >
                <div className="type-icon"><AppIcon name={iconName as string} /></div>
                <div className="type-label">{label}</div>
              </button>
            ))}
          </div>
        </>
      )}

      {myPasses.length > 0 && (
        <div className="search-wrap u-mb8">
          <span className="search-ico"><AppIcon name="search" size={14} /></span>
          <input
            className="search-inp"
            placeholder="Имя, авто или комментарий"
            value={query}
            onChange={(event) => updatePassSearch(event.target.value)}
          />
        </div>
      )}

      {myPasses.length > 0 && (
        <div className="pass-filter-pills">
          {PASS_FILTER_PILLS.map(([key, label]) => {
            const count = key === 'scheduled'
              ? scheduledCount
              : key === 'all'
                ? myPasses.length
                : key === 'temporary'
                  ? tempCount
                  : key === 'permanent'
                    ? permCount
                    : key === 'once'
                      ? myPasses.length - tempCount - permCount
                      : 0;
            return count > 0 || key === 'all' || key === 'active' ? (
              <button
                key={key}
                className={`date-pill${passFilter === key ? ' active' : ''}`}
                onClick={() => setPassFilter(key)}
              >
                {label}
                {count > 0 && key !== 'all' && key !== 'active' ? ` (${count})` : ''}
              </button>
            ) : null;
          })}
        </div>
      )}

      {isResidentExperience && myPasses.length > 0 && (
        <SectionHeader
          title="Ваши пропуска"
          count={visiblePasses.length + visibleScheduled.length}
          className="resident-passes-header"
        />
      )}

      {visiblePasses.length === 0 && myPasses.length === 0 ? (
        <StateBlock
          type="empty"
          title={isResidentExperience ? 'Пока нет пропусков' : 'Рабочих пропусков пока нет'}
          subtitle={isResidentExperience ? 'Нажмите «Новый пропуск», когда к вам собирается гость, курьер или такси.' : 'Начните с «Оформить въезд» или выберите ниже бригаду, доставку или автомобиль.'}
        />
      ) : visiblePasses.length === 0 && visibleScheduled.length === 0 ? (
        <StateBlock
          type="empty"
          title={debouncedQuery ? 'Ничего не найдено' : passesEmptyCopy.title}
          subtitle={debouncedQuery ? 'Попробуйте другой запрос' : 'Нет пропусков в этой категории'}
        />
      ) : (
        <>
          {visibleScheduled.length > 0 && passFilter !== 'scheduled' && (
            <div className="u-mb-12">
              <SectionHeader title="Запланированные" count={visibleScheduled.length} />
              <OperationalRequestList
                items={visibleScheduled}
                userRole={user.role}
                userName={user.name}
                userId={user.uid}
                onRepeat={onRepeatPass}
                onEdit={onEdit}
                onDelete={onDelete}
                onCancel={onCancel}
              />
            </div>
          )}
          <OperationalRequestList
            items={visiblePasses}
            userRole={user.role}
            userName={user.name}
            userId={user.uid}
            onRepeat={onRepeatPass}
            onEdit={onEdit}
            onDelete={onDelete}
            onCancel={onCancel}
          />
        </>
      )}
    </div>
  );
});

export default PassesTab;
