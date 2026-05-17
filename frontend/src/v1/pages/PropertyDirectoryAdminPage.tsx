import { useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  isV1ApiError,
  type Building,
  type ContractorCompany,
  type ContractorCompanyStatus,
  type ContractorImportRowInput,
  type ContractorUser,
  type Entrance,
  type MembershipScopeLevel,
  type MembershipStatus,
  type MembershipSubjectType,
  type PropertyType,
  type ResidentWithUnit,
  type ResidentType,
  type RoleScopeMembership,
  type StaffRole,
  type StaffSpecialization,
  type StaffImportRowInput,
  type StaffUser,
  type Unit,
  type UnitType,
  type UserRole,
} from '../api';
import { useV1Session } from '../store';
import { formatDateTime } from '../components/formatters';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Inline,
  Input,
  Select,
  Spinner,
  Stack,
  Textarea,
  uiClasses,
} from '../components/ui';
import type { BadgeTone } from '../components/ui';
import { formatUnitLabel, getPropertyLabels } from '../lib/propertyLabels';

type DirectoryTab = 'structure' | 'residents' | 'staff' | 'contractors' | 'memberships';
type LimitKey = 'units' | 'residents' | 'staff' | 'companies' | 'contractorUsers' | 'memberships';

const TAB_LABELS: Record<DirectoryTab, string> = {
  structure: 'Структура',
  residents: 'Жители',
  staff: 'Сотрудники',
  contractors: 'Подрядчики',
  memberships: 'Членства',
};

const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  security: 'Охрана',
  concierge: 'Консьерж',
  technician: 'Техник',
  property_admin: 'Администратор объекта',
};

const COMPANY_STATUS_LABELS: Record<ContractorCompanyStatus, string> = {
  active: 'Активна',
  suspended: 'Приостановлена',
  terminated: 'Завершена',
};

const MEMBERSHIP_STATUS_LABELS: Record<MembershipStatus, string> = {
  pending: 'Ожидает',
  active: 'Активно',
  suspended: 'Приостановлено',
  revoked: 'Отозвано',
  ended: 'Завершено',
};

const RESIDENT_TYPE_LABELS: Record<string, string> = {
  owner: 'Собственник',
  tenant: 'Арендатор',
  family_member: 'Семья',
};

const UNIT_TYPES: UnitType[] = ['apartment', 'townhouse', 'house', 'commercial', 'utility'];
const RESIDENT_TYPES: ResidentType[] = ['owner', 'tenant', 'family_member'];
const STAFF_ROLES: StaffRole[] = ['security', 'concierge', 'technician', 'property_admin'];
const STAFF_SPECIALIZATIONS: Array<StaffSpecialization | ''> = ['', 'plumbing', 'electric', 'cleaning', 'general'];
const COMPANY_STATUSES: ContractorCompanyStatus[] = ['active', 'suspended', 'terminated'];
const MEMBERSHIP_SUBJECT_TYPES: MembershipSubjectType[] = ['resident', 'staff', 'contractor', 'external'];
const MEMBERSHIP_SCOPE_LEVELS: MembershipScopeLevel[] = ['property', 'building', 'entrance', 'unit', 'management_company', 'platform'];
const MEMBERSHIP_ROLES: UserRole[] = [
  'resident',
  'owner',
  'tenant',
  'contractor',
  'concierge',
  'security',
  'technician',
  'property_admin',
  'management_company_admin',
  'platform_admin',
];

const LIMIT = 50;
const ENTRANCE_BATCH_SIZE = 12;
const INITIAL_LIMITS: Record<LimitKey, number> = {
  units: LIMIT,
  residents: LIMIT,
  staff: LIMIT,
  companies: LIMIT,
  contractorUsers: LIMIT,
  memberships: LIMIT,
};

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}

function errorMessage(error: unknown): string {
  return isV1ApiError(error) ? error.message : 'неизвестная ошибка';
}

function statusTone(status: string | null | undefined): BadgeTone {
  if (status === 'active') return 'success';
  if (status === 'pending') return 'info';
  if (status === 'suspended') return 'warning';
  if (status === 'revoked' || status === 'terminated') return 'error';
  if (status === 'ended') return 'neutral';
  return 'neutral';
}

function staffRoleLabel(role: StaffRole | string): string {
  return (STAFF_ROLE_LABELS as Record<string, string>)[role] ?? role;
}

function companyStatusLabel(status: ContractorCompanyStatus | string): string {
  return (COMPANY_STATUS_LABELS as Record<string, string>)[status] ?? status;
}

function membershipStatusLabel(status: string): string {
  return (MEMBERSHIP_STATUS_LABELS as Record<string, string>)[status] ?? status;
}

function residentTypeLabel(type: string): string {
  return RESIDENT_TYPE_LABELS[type] ?? type;
}

function idShort(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : '—';
}

function pageHint(page: { hasMore: boolean } | undefined, loaded: number): string {
  return page?.hasMore
    ? `Показаны первые ${formatNumber(loaded)} строк`
    : `${formatNumber(loaded)} строк`;
}

function matchesText(values: Array<string | null | undefined>, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return values.some((value) => value?.toLowerCase().includes(needle));
}

function parseRows<T extends object>(value: string, fallback: T[]): T[] {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new Error('JSON должен быть массивом объектов');
  }
  return parsed as T[];
}

export function PropertyDirectoryAdminPage() {
  const queryClient = useQueryClient();
  const session = useV1Session();
  const labels = useMemo(() => getPropertyLabels(session.property_type), [session.property_type]);
  const propertyId = session.property_id ?? null;
  const [tab, setTab] = useState<DirectoryTab>('structure');
  const [query, setQuery] = useState('');
  const [limits, setLimits] = useState<Record<LimitKey, number>>(INITIAL_LIMITS);
  const [entranceLimit, setEntranceLimit] = useState(ENTRANCE_BATCH_SIZE);
  const [formError, setFormError] = useState<string | null>(null);
  const normalizedQuery = query.trim();

  const increaseLimit = (key: LimitKey) => {
    setLimits((current) => ({ ...current, [key]: current[key] + LIMIT }));
  };
  const invalidateDirectory = () => {
    void queryClient.invalidateQueries({ queryKey: ['v1', 'directory'] });
  };
  const run = (action: () => void) => {
    setFormError(null);
    try {
      action();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Некорректные данные формы');
    }
  };

  const buildingsQuery = useQuery({
    queryKey: ['v1', 'directory', propertyId, 'buildings'],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.units.listBuildings({ signal }),
  });

  const unitsQuery = useQuery({
    queryKey: ['v1', 'directory', propertyId, 'units', normalizedQuery, limits.units],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.units.list({
      is_active: true,
      limit: limits.units,
      q: normalizedQuery || undefined,
    }, { signal }),
  });

  const residentsQuery = useQuery({
    queryKey: ['v1', 'directory', propertyId, 'residents', normalizedQuery, limits.residents],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.residents.list({
      is_active: true,
      limit: limits.residents,
      q: normalizedQuery || undefined,
    }, { signal }),
  });

  const staffQuery = useQuery({
    queryKey: ['v1', 'directory', propertyId, 'staff', normalizedQuery, limits.staff],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.staff.list({
      is_active: true,
      limit: limits.staff,
      q: normalizedQuery || undefined,
    }, { signal }),
  });

  const companiesQuery = useQuery({
    queryKey: ['v1', 'directory', propertyId, 'contractor-companies', normalizedQuery, limits.companies],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.contractors.listCompanies({
      status: 'active',
      limit: limits.companies,
      q: normalizedQuery || undefined,
    }, { signal }),
  });

  const contractorUsersQuery = useQuery({
    queryKey: ['v1', 'directory', propertyId, 'contractor-users', limits.contractorUsers],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.contractors.listUsers({
      is_active: true,
      limit: limits.contractorUsers,
    }, { signal }),
  });

  const membershipsQuery = useQuery({
    queryKey: ['v1', 'directory', propertyId, 'memberships', limits.memberships],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.memberships.list({
      property_id: propertyId ?? '',
      limit: limits.memberships,
    }, { signal }),
  });

  const buildings = buildingsQuery.data?.buildings ?? [];
  const entranceQueries = useQueries({
    queries: buildings.slice(0, entranceLimit).map((building) => ({
      queryKey: ['v1', 'directory', propertyId, 'building-entrances', building.id],
      enabled: Boolean(propertyId),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.units.listEntrances(building.id, { signal }),
    })),
  });

  const error = buildingsQuery.error
    || unitsQuery.error
    || residentsQuery.error
    || staffQuery.error
    || companiesQuery.error
    || contractorUsersQuery.error
    || membershipsQuery.error
    || entranceQueries.find((item) => item.error)?.error;

  const loading = buildingsQuery.isLoading
    || unitsQuery.isLoading
    || residentsQuery.isLoading
    || staffQuery.isLoading
    || companiesQuery.isLoading
    || contractorUsersQuery.isLoading
    || membershipsQuery.isLoading;

  const contractorUsers = useMemo(() => (
    (contractorUsersQuery.data?.users ?? []).filter((user) => matchesText([
      user.full_name,
      user.email,
      user.phone,
      user.specialization,
    ], normalizedQuery))
  ), [contractorUsersQuery.data?.users, normalizedQuery]);

  const memberships = useMemo(() => (
    (membershipsQuery.data?.memberships ?? []).filter((membership) => matchesText([
      membershipSubjectLabel(membership),
      membership.role,
      membership.scope_level,
      membership.scope_id,
      membership.status,
      membership.provisioned_from,
    ], normalizedQuery))
  ), [membershipsQuery.data?.memberships, normalizedQuery]);

  if (!propertyId) {
    return (
      <div className={uiClasses.pageShell}>
        <Alert tone="error">
          Не удалось определить объект. Проверьте привязку администратора к property.
        </Alert>
      </div>
    );
  }

  return (
    <div className={uiClasses.pageShell}>
      <header className={uiClasses.pageHeader}>
        <h1 className={uiClasses.pageTitle}>Справочник объекта</h1>
        <p className={uiClasses.pageSubtitle}>
          {labels.propertyKind}: структура, жители, сотрудники, подрядчики и role-scope членства.
        </p>
      </header>

      <Card>
        <Field label="Поиск">
          <Input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="ФИО, email, юнит, компания, роль или scope"
          />
        </Field>
        <Inline>
          <SummaryBadge label="Корпуса" value={buildings.length} />
          <SummaryBadge label={labels.unit} value={unitsQuery.data?.units.length ?? 0} />
          <SummaryBadge label="Жители" value={residentsQuery.data?.residents.length ?? 0} />
          <SummaryBadge label="Сотрудники" value={staffQuery.data?.staff.length ?? 0} />
          <SummaryBadge label="Подрядчики" value={companiesQuery.data?.companies.length ?? 0} />
          <SummaryBadge label="Членства" value={membershipsQuery.data?.memberships.length ?? 0} />
        </Inline>
      </Card>

      <div className={uiClasses.tabs} role="tablist" aria-label="Разделы справочника объекта">
        {(Object.keys(TAB_LABELS) as DirectoryTab[]).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            className={`${uiClasses.tab} ${tab === item ? uiClasses.tabActive : ''}`}
            onClick={() => setTab(item)}
          >
            {TAB_LABELS[item]}
          </button>
        ))}
      </div>

      {error ? (
        <Alert tone="error">
          Не удалось загрузить справочник: {errorMessage(error)}
        </Alert>
      ) : null}
      {formError ? <Alert tone="error">{formError}</Alert> : null}

      {loading ? (
        <Inline>
          <Spinner />
          <span className={uiClasses.textMuted}>Загрузка справочника…</span>
        </Inline>
      ) : null}

      {tab === 'structure' ? (
        <StructureTab
          buildings={buildings}
          entranceQueries={entranceQueries.map((item) => item.data?.entrances ?? [])}
          loadedEntranceCount={Math.min(entranceLimit, buildings.length)}
          onLoadMoreEntrances={
            buildings.length > entranceLimit
              ? () => setEntranceLimit((current) => current + ENTRANCE_BATCH_SIZE)
              : undefined
          }
          units={unitsQuery.data?.units ?? []}
          unitPageHint={pageHint(unitsQuery.data?.page, unitsQuery.data?.units.length ?? 0)}
          unitHasMore={Boolean(unitsQuery.data?.page?.hasMore)}
          unitLoadingMore={unitsQuery.isFetching && !unitsQuery.isLoading}
          onLoadMoreUnits={() => increaseLimit('units')}
          propertyType={session.property_type ?? null}
          propertyId={propertyId}
          invalidate={invalidateDirectory}
          run={run}
        />
      ) : null}
      {tab === 'residents' ? (
        <ResidentsTab
          residents={residentsQuery.data?.residents ?? []}
          pageHint={pageHint(residentsQuery.data?.page, residentsQuery.data?.residents.length ?? 0)}
          hasMore={Boolean(residentsQuery.data?.page?.hasMore)}
          loadingMore={residentsQuery.isFetching && !residentsQuery.isLoading}
          onLoadMore={() => increaseLimit('residents')}
          propertyId={propertyId}
          invalidate={invalidateDirectory}
        />
      ) : null}
      {tab === 'staff' ? (
        <StaffTab
          staff={staffQuery.data?.staff ?? []}
          pageHint={pageHint(staffQuery.data?.page, staffQuery.data?.staff.length ?? 0)}
          hasMore={Boolean(staffQuery.data?.page?.hasMore)}
          loadingMore={staffQuery.isFetching && !staffQuery.isLoading}
          onLoadMore={() => increaseLimit('staff')}
          propertyId={propertyId}
          invalidate={invalidateDirectory}
          run={run}
        />
      ) : null}
      {tab === 'contractors' ? (
        <ContractorsTab
          companies={companiesQuery.data?.companies ?? []}
          users={contractorUsers}
          companyHint={pageHint(companiesQuery.data?.page, companiesQuery.data?.companies.length ?? 0)}
          userHint={pageHint(contractorUsersQuery.data?.page, contractorUsersQuery.data?.users.length ?? 0)}
          companiesHasMore={Boolean(companiesQuery.data?.page?.hasMore)}
          usersHasMore={Boolean(contractorUsersQuery.data?.page?.hasMore)}
          companiesLoadingMore={companiesQuery.isFetching && !companiesQuery.isLoading}
          usersLoadingMore={contractorUsersQuery.isFetching && !contractorUsersQuery.isLoading}
          onLoadMoreCompanies={() => increaseLimit('companies')}
          onLoadMoreUsers={() => increaseLimit('contractorUsers')}
          propertyId={propertyId}
          invalidate={invalidateDirectory}
          run={run}
        />
      ) : null}
      {tab === 'memberships' ? (
        <MembershipsTab
          memberships={memberships}
          pageHint={pageHint(membershipsQuery.data?.page, membershipsQuery.data?.memberships.length ?? 0)}
          hasMore={Boolean(membershipsQuery.data?.page?.hasMore)}
          loadingMore={membershipsQuery.isFetching && !membershipsQuery.isLoading}
          onLoadMore={() => increaseLimit('memberships')}
          propertyId={propertyId}
          invalidate={invalidateDirectory}
        />
      ) : null}
    </div>
  );
}

function SummaryBadge({ label, value }: { label: string; value: number }) {
  return (
    <Badge tone={value > 0 ? 'info' : 'neutral'}>
      {label}: {formatNumber(value)}
    </Badge>
  );
}

function LoadMoreButton({
  children,
  loading,
  onClick,
}: {
  children: string;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <Inline className={uiClasses.marginTop3}>
      <Button variant="secondary" loading={loading} onClick={onClick}>
        {children}
      </Button>
    </Inline>
  );
}

function StructureTab({
  buildings,
  entranceQueries,
  loadedEntranceCount,
  onLoadMoreEntrances,
  units,
  unitPageHint,
  unitHasMore,
  unitLoadingMore,
  onLoadMoreUnits,
  propertyType,
  propertyId,
  invalidate,
  run,
}: {
  buildings: Building[];
  entranceQueries: Entrance[][];
  loadedEntranceCount: number;
  onLoadMoreEntrances?: () => void;
  units: Unit[];
  unitPageHint: string;
  unitHasMore: boolean;
  unitLoadingMore: boolean;
  onLoadMoreUnits: () => void;
  propertyType: PropertyType | null;
  propertyId: string;
  invalidate: () => void;
  run: (action: () => void) => void;
}) {
  const [buildingName, setBuildingName] = useState('');
  const [buildingCode, setBuildingCode] = useState('');
  const [entranceBuildingId, setEntranceBuildingId] = useState('');
  const [entranceName, setEntranceName] = useState('');
  const [entranceCode, setEntranceCode] = useState('');
  const [unitId, setUnitId] = useState('');
  const [unitBuildingId, setUnitBuildingId] = useState('');
  const [unitEntranceId, setUnitEntranceId] = useState('');
  const [unitNumber, setUnitNumber] = useState('');
  const [unitType, setUnitType] = useState<UnitType>('apartment');
  const [unitFloor, setUnitFloor] = useState('');
  const [unitRows, setUnitRows] = useState('[{"building":"A","entrance":"1","unit_number":"101"}]');

  const createBuilding = useMutation({
    mutationFn: () => api.units.createBuilding({
      property_id: propertyId,
      name: buildingName.trim() || 'Новый корпус',
      code: buildingCode.trim() || null,
      sort_order: buildings.length + 1,
    }),
    onSuccess: invalidate,
  });
  const createEntrance = useMutation({
    mutationFn: () => api.units.createEntrance({
      building_id: entranceBuildingId.trim(),
      name: entranceName.trim() || 'Новый вход',
      code: entranceCode.trim() || null,
      sort_order: 1,
    }),
    onSuccess: invalidate,
  });
  const getUnit = useMutation({
    mutationFn: () => api.units.getById(unitId.trim()),
  });
  const createUnit = useMutation({
    mutationFn: () => api.units.create({
      property_id: propertyId,
      building_id: unitBuildingId.trim(),
      entrance_id: unitEntranceId.trim(),
      unit_number: unitNumber.trim() || '101',
      unit_type: unitType,
      floor: unitFloor.trim() ? Number(unitFloor) : null,
    }),
    onSuccess: invalidate,
  });
  const updateUnit = useMutation({
    mutationFn: () => api.units.update(unitId.trim(), {
      unit_number: unitNumber.trim() || undefined,
      unit_type: unitType,
      floor: unitFloor.trim() ? Number(unitFloor) : null,
    }),
    onSuccess: invalidate,
  });
  const deactivateUnit = useMutation({
    mutationFn: () => api.units.deactivate(unitId.trim()),
    onSuccess: invalidate,
  });
  const importUnits = useMutation({
    mutationFn: () => api.units.importRows({
      property_id: propertyId,
      property_type: propertyType,
      rows: parseRows(unitRows, []),
    }),
    onSuccess: invalidate,
  });

  return (
    <Stack>
      <Card title="Операции структуры" subtitle="Корпуса, входы, юниты и импорт строк.">
        <Stack>
          <div className={uiClasses.formGrid}>
            <Field label="Building name">
              <Input value={buildingName} onChange={(event) => setBuildingName(event.currentTarget.value)} placeholder="Корпус B" />
            </Field>
            <Field label="Building code">
              <Input value={buildingCode} onChange={(event) => setBuildingCode(event.currentTarget.value)} placeholder="B" />
            </Field>
            <Button loading={createBuilding.isPending} onClick={() => createBuilding.mutate()}>Создать корпус</Button>
          </div>

          <div className={uiClasses.formGrid}>
            <Field label="Entrance building ID">
              <Input value={entranceBuildingId} onChange={(event) => setEntranceBuildingId(event.currentTarget.value)} placeholder="building-uuid" />
            </Field>
            <Field label="Entrance name">
              <Input value={entranceName} onChange={(event) => setEntranceName(event.currentTarget.value)} placeholder="Подъезд 2" />
            </Field>
            <Field label="Entrance code">
              <Input value={entranceCode} onChange={(event) => setEntranceCode(event.currentTarget.value)} placeholder="2" />
            </Field>
            <Button loading={createEntrance.isPending} onClick={() => createEntrance.mutate()}>Создать вход</Button>
          </div>

          <div className={uiClasses.formGrid}>
            <Field label="Unit ID">
              <Input value={unitId} onChange={(event) => setUnitId(event.currentTarget.value)} placeholder="unit-uuid" />
            </Field>
            <Field label="Unit building ID">
              <Input value={unitBuildingId} onChange={(event) => setUnitBuildingId(event.currentTarget.value)} placeholder="building-uuid" />
            </Field>
            <Field label="Unit entrance ID">
              <Input value={unitEntranceId} onChange={(event) => setUnitEntranceId(event.currentTarget.value)} placeholder="entrance-uuid" />
            </Field>
            <Field label="Unit number">
              <Input value={unitNumber} onChange={(event) => setUnitNumber(event.currentTarget.value)} placeholder="101" />
            </Field>
            <Field label="Unit type">
              <Select value={unitType} onChange={(event) => setUnitType(event.currentTarget.value as UnitType)}>
                {UNIT_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Field>
            <Field label="Floor">
              <Input value={unitFloor} onChange={(event) => setUnitFloor(event.currentTarget.value)} inputMode="numeric" placeholder="8" />
            </Field>
          </div>
          <Inline>
            <Button variant="secondary" loading={getUnit.isPending} onClick={() => getUnit.mutate()}>Загрузить unit</Button>
            <Button variant="secondary" loading={createUnit.isPending} onClick={() => createUnit.mutate()}>Создать unit</Button>
            <Button variant="secondary" loading={updateUnit.isPending} onClick={() => updateUnit.mutate()}>Обновить unit</Button>
            <Button variant="danger" loading={deactivateUnit.isPending} onClick={() => deactivateUnit.mutate()}>Деактивировать unit</Button>
          </Inline>
          {getUnit.data ? <Alert tone="info">Unit загружен: {formatUnitLabel(getUnit.data.unit, propertyType)}</Alert> : null}

          <Field label="Unit import rows JSON">
            <Textarea value={unitRows} onChange={(event) => setUnitRows(event.currentTarget.value)} rows={3} />
          </Field>
          <Button variant="secondary" loading={importUnits.isPending} onClick={() => run(() => importUnits.mutate())}>
            Импортировать юниты
          </Button>
        </Stack>
      </Card>

      <div className={uiClasses.twoColumn}>
      <Card title="Корпуса и входы" subtitle={`${formatNumber(buildings.length)} корпусов`}>
        {buildings.length ? (
          <ul className={uiClasses.resourceList}>
            {buildings.map((building, index) => (
              <li key={building.id} className={uiClasses.resourceRow}>
                <div className={uiClasses.resourceRowMain}>
                  <p className={uiClasses.resourceTitle}>{building.name}</p>
                  <div className={uiClasses.resourceMeta}>
                    <span>код {building.code || '—'}</span>
                    <span>порядок {formatNumber(building.sort_order)}</span>
                    <span>
                      входов {index < loadedEntranceCount
                        ? formatNumber(entranceQueries[index]?.length ?? 0)
                        : 'не загружено'}
                    </span>
                  </div>
                </div>
                <Badge>{idShort(building.id)}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>Корпуса не найдены.</EmptyState>
        )}
        {onLoadMoreEntrances ? (
          <LoadMoreButton onClick={onLoadMoreEntrances}>
            Загрузить входы ещё
          </LoadMoreButton>
        ) : null}
      </Card>

      <Card title="Юниты" subtitle={unitPageHint}>
        {units.length ? (
          <ul className={uiClasses.resourceList}>
            {units.map((unit) => (
              <li key={unit.id} className={uiClasses.resourceRow}>
                <div className={uiClasses.resourceRowMain}>
                  <p className={uiClasses.resourceTitle}>{formatUnitLabel(unit, propertyType)}</p>
                  <div className={uiClasses.resourceMeta}>
                    <span>этаж {unit.floor ?? '—'}</span>
                    <span>корпус {idShort(unit.building_id)}</span>
                    <span>вход {idShort(unit.entrance_id)}</span>
                  </div>
                </div>
                <Badge tone={unit.is_active ? 'success' : 'neutral'}>
                  {unit.is_active ? 'активен' : 'неактивен'}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>Юниты не найдены.</EmptyState>
        )}
        {unitHasMore ? (
          <LoadMoreButton loading={unitLoadingMore} onClick={onLoadMoreUnits}>
            Показать ещё юниты
          </LoadMoreButton>
        ) : null}
      </Card>
      </div>
    </Stack>
  );
}

function ResidentsTab({
  residents,
  pageHint,
  hasMore,
  loadingMore,
  onLoadMore,
  propertyId,
  invalidate,
}: {
  residents: ResidentWithUnit[];
  pageHint: string;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  propertyId: string;
  invalidate: () => void;
}) {
  const [residentId, setResidentId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [residentType, setResidentType] = useState<ResidentType>('owner');
  const [toResidentId, setToResidentId] = useState('');
  const [reason, setReason] = useState('');
  const [consentVersion, setConsentVersion] = useState('2026-05-17');

  const createResident = useMutation({
    mutationFn: () => api.residents.create({
      property_id: propertyId,
      unit_id: unitId.trim(),
      full_name: fullName.trim() || 'Новый житель',
      phone: phone.trim() || '+70000000000',
      email: email.trim() || null,
      resident_type: residentType,
    }),
    onSuccess: invalidate,
  });
  const updateResident = useMutation({
    mutationFn: () => api.residents.update(residentId.trim(), {
      unit_id: unitId.trim() || undefined,
      full_name: fullName.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || null,
      resident_type: residentType,
    }),
    onSuccess: invalidate,
  });
  const deactivateResident = useMutation({
    mutationFn: () => api.residents.deactivate(residentId.trim(), { reason: reason.trim() || null }),
    onSuccess: invalidate,
  });
  const transferOwnership = useMutation({
    mutationFn: () => api.residents.transferOwnership(residentId.trim(), {
      to_resident_id: toResidentId.trim(),
      reason: reason.trim() || null,
      cascade_notification_preferences: true,
    }),
    onSuccess: invalidate,
  });
  const recordConsent = useMutation({
    mutationFn: () => api.residents.consent(residentId.trim(), { consent_version: consentVersion.trim() }),
    onSuccess: invalidate,
  });

  return (
    <Stack>
      <Card title="Операции жителей" subtitle="Create, update, deactivate, ownership transfer и consent.">
        <Stack>
          <div className={uiClasses.formGrid}>
            <Field label="Resident ID">
              <Input value={residentId} onChange={(event) => setResidentId(event.currentTarget.value)} placeholder="resident-uuid" />
            </Field>
            <Field label="Unit ID">
              <Input value={unitId} onChange={(event) => setUnitId(event.currentTarget.value)} placeholder="unit-uuid" />
            </Field>
            <Field label="Full name">
              <Input value={fullName} onChange={(event) => setFullName(event.currentTarget.value)} placeholder="Иван Житель" />
            </Field>
            <Field label="Phone">
              <Input value={phone} onChange={(event) => setPhone(event.currentTarget.value)} placeholder="+79990000003" />
            </Field>
            <Field label="Email">
              <Input value={email} onChange={(event) => setEmail(event.currentTarget.value)} placeholder="ivan@example.test" />
            </Field>
            <Field label="Resident type">
              <Select value={residentType} onChange={(event) => setResidentType(event.currentTarget.value as ResidentType)}>
                {RESIDENT_TYPES.map((item) => <option key={item} value={item}>{residentTypeLabel(item)}</option>)}
              </Select>
            </Field>
            <Field label="To resident ID">
              <Input value={toResidentId} onChange={(event) => setToResidentId(event.currentTarget.value)} placeholder="new-owner-uuid" />
            </Field>
            <Field label="Reason">
              <Input value={reason} onChange={(event) => setReason(event.currentTarget.value)} placeholder="Переезд" />
            </Field>
            <Field label="Consent version">
              <Input value={consentVersion} onChange={(event) => setConsentVersion(event.currentTarget.value)} placeholder="2026-05-17" />
            </Field>
          </div>
          <Inline>
            <Button loading={createResident.isPending} onClick={() => createResident.mutate()}>Создать жителя</Button>
            <Button variant="secondary" loading={updateResident.isPending} onClick={() => updateResident.mutate()}>Обновить жителя</Button>
            <Button variant="danger" loading={deactivateResident.isPending} onClick={() => deactivateResident.mutate()}>Деактивировать жителя</Button>
            <Button variant="secondary" loading={transferOwnership.isPending} onClick={() => transferOwnership.mutate()}>Передать ownership</Button>
            <Button variant="secondary" loading={recordConsent.isPending} onClick={() => recordConsent.mutate()}>Зафиксировать consent</Button>
          </Inline>
        </Stack>
      </Card>

      <Card title="Жители" subtitle={pageHint}>
      {residents.length ? (
        <ul className={uiClasses.resourceList}>
          {residents.map((resident) => (
            <li key={resident.id} className={uiClasses.resourceRow}>
              <div className={uiClasses.resourceRowMain}>
                <p className={uiClasses.resourceTitle}>{resident.full_name}</p>
                <div className={uiClasses.resourceMeta}>
                  <span>{residentTypeLabel(resident.resident_type)}</span>
                  <span>юнит {idShort(resident.unit_id)}</span>
                  <span>{resident.email || 'email —'}</span>
                  <span>{resident.phone || 'телефон —'}</span>
                </div>
              </div>
              <Badge tone={resident.is_active ? 'success' : 'neutral'}>
                {resident.is_active ? 'активен' : 'неактивен'}
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>Жители не найдены.</EmptyState>
      )}
      {hasMore ? (
        <LoadMoreButton loading={loadingMore} onClick={onLoadMore}>
          Показать ещё жителей
        </LoadMoreButton>
      ) : null}
      </Card>
    </Stack>
  );
}

function StaffTab({
  staff,
  pageHint,
  hasMore,
  loadingMore,
  onLoadMore,
  propertyId,
  invalidate,
  run,
}: {
  staff: StaffUser[];
  pageHint: string;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  propertyId: string;
  invalidate: () => void;
  run: (action: () => void) => void;
}) {
  const [staffId, setStaffId] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<StaffRole>('concierge');
  const [specialization, setSpecialization] = useState<StaffSpecialization | ''>('');
  const [canViewPhone, setCanViewPhone] = useState('true');
  const [canAssign, setCanAssign] = useState('true');
  const [importRows, setImportRows] = useState('[{"full_name":"Мария Консьерж","email":"maria@example.test","role":"concierge"}]');

  const getStaff = useMutation({
    mutationFn: () => api.staff.getById(staffId.trim()),
  });
  const createStaff = useMutation({
    mutationFn: () => api.staff.create({
      property_id: propertyId,
      full_name: fullName.trim() || 'Новый сотрудник',
      email: email.trim() || 'staff@example.test',
      phone: phone.trim() || null,
      role,
      specialization: specialization || null,
      can_view_resident_phone: canViewPhone === 'true',
      can_assign_requests: canAssign === 'true',
    }),
    onSuccess: invalidate,
  });
  const updateStaff = useMutation({
    mutationFn: () => api.staff.update(staffId.trim(), {
      full_name: fullName.trim() || undefined,
      phone: phone.trim() || null,
      role,
      specialization: specialization || null,
      can_view_resident_phone: canViewPhone === 'true',
      can_assign_requests: canAssign === 'true',
    }),
    onSuccess: invalidate,
  });
  const deactivateStaff = useMutation({
    mutationFn: () => api.staff.deactivate(staffId.trim()),
    onSuccess: invalidate,
  });
  const previewStaffImport = useMutation({
    mutationFn: () => api.staff.previewImport({
      property_id: propertyId,
      rows: parseRows<StaffImportRowInput>(importRows, []),
    }),
  });
  const applyStaffImport = useMutation({
    mutationFn: () => api.staff.applyImport({
      property_id: propertyId,
      rows: parseRows<StaffImportRowInput>(importRows, []),
    }),
    onSuccess: invalidate,
  });
  const staffTemplateUrl = api.staff.importTemplateUrl();

  return (
    <Stack>
      <Card title="Операции сотрудников" subtitle="Detail, create/update/deactivate и import preview/apply.">
        <Stack>
          <div className={uiClasses.formGrid}>
            <Field label="Staff ID">
              <Input value={staffId} onChange={(event) => setStaffId(event.currentTarget.value)} placeholder="staff-uuid" />
            </Field>
            <Field label="Full name">
              <Input value={fullName} onChange={(event) => setFullName(event.currentTarget.value)} placeholder="Мария Консьерж" />
            </Field>
            <Field label="Email">
              <Input value={email} onChange={(event) => setEmail(event.currentTarget.value)} placeholder="maria@example.test" />
            </Field>
            <Field label="Phone">
              <Input value={phone} onChange={(event) => setPhone(event.currentTarget.value)} placeholder="+79990000001" />
            </Field>
            <Field label="Role">
              <Select value={role} onChange={(event) => setRole(event.currentTarget.value as StaffRole)}>
                {STAFF_ROLES.map((item) => <option key={item} value={item}>{staffRoleLabel(item)}</option>)}
              </Select>
            </Field>
            <Field label="Specialization">
              <Select value={specialization} onChange={(event) => setSpecialization(event.currentTarget.value as StaffSpecialization | '')}>
                {STAFF_SPECIALIZATIONS.map((item) => <option key={item || 'none'} value={item}>{item || '—'}</option>)}
              </Select>
            </Field>
            <Field label="Can view phones">
              <Select value={canViewPhone} onChange={(event) => setCanViewPhone(event.currentTarget.value)}>
                <option value="true">да</option>
                <option value="false">нет</option>
              </Select>
            </Field>
            <Field label="Can assign">
              <Select value={canAssign} onChange={(event) => setCanAssign(event.currentTarget.value)}>
                <option value="true">да</option>
                <option value="false">нет</option>
              </Select>
            </Field>
          </div>
          <Inline>
            <Button variant="secondary" loading={getStaff.isPending} onClick={() => getStaff.mutate()}>Загрузить staff</Button>
            <Button loading={createStaff.isPending} onClick={() => createStaff.mutate()}>Создать staff</Button>
            <Button variant="secondary" loading={updateStaff.isPending} onClick={() => updateStaff.mutate()}>Обновить staff</Button>
            <Button variant="danger" loading={deactivateStaff.isPending} onClick={() => deactivateStaff.mutate()}>Деактивировать staff</Button>
            <Button variant="ghost" onClick={() => window.location.assign(staffTemplateUrl)}>CSV template</Button>
          </Inline>
          {getStaff.data ? <Alert tone="info">Staff загружен: {getStaff.data.staff.full_name}</Alert> : null}

          <Field label="Staff import rows JSON">
            <Textarea value={importRows} onChange={(event) => setImportRows(event.currentTarget.value)} rows={3} />
          </Field>
          <Inline>
            <Button variant="secondary" loading={previewStaffImport.isPending} onClick={() => run(() => previewStaffImport.mutate())}>Preview staff import</Button>
            <Button variant="secondary" loading={applyStaffImport.isPending} onClick={() => run(() => applyStaffImport.mutate())}>Apply staff import</Button>
          </Inline>
        </Stack>
      </Card>

      <Card title="Сотрудники" subtitle={pageHint}>
      {staff.length ? (
        <ul className={uiClasses.resourceList}>
          {staff.map((member) => (
            <li key={member.id} className={uiClasses.resourceRow}>
              <div className={uiClasses.resourceRowMain}>
                <p className={uiClasses.resourceTitle}>{member.full_name}</p>
                <div className={uiClasses.resourceMeta}>
                  <span>{staffRoleLabel(member.role)}</span>
                  <span>{member.email || 'email —'}</span>
                  <span>{member.phone || 'телефон —'}</span>
                  <span>назначения: {member.can_assign_requests ? 'да' : 'нет'}</span>
                  <span>телефоны жителей: {member.can_view_resident_phone ? 'да' : 'нет'}</span>
                </div>
              </div>
              <Badge tone={member.is_active ? 'success' : 'neutral'}>
                {member.is_active ? 'активен' : 'неактивен'}
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>Сотрудники не найдены.</EmptyState>
      )}
      {hasMore ? (
        <LoadMoreButton loading={loadingMore} onClick={onLoadMore}>
          Показать ещё сотрудников
        </LoadMoreButton>
      ) : null}
      </Card>
    </Stack>
  );
}

function ContractorsTab({
  companies,
  users,
  companyHint,
  userHint,
  companiesHasMore,
  usersHasMore,
  companiesLoadingMore,
  usersLoadingMore,
  onLoadMoreCompanies,
  onLoadMoreUsers,
  propertyId,
  invalidate,
  run,
}: {
  companies: ContractorCompany[];
  users: ContractorUser[];
  companyHint: string;
  userHint: string;
  companiesHasMore: boolean;
  usersHasMore: boolean;
  companiesLoadingMore: boolean;
  usersLoadingMore: boolean;
  onLoadMoreCompanies: () => void;
  onLoadMoreUsers: () => void;
  propertyId: string;
  invalidate: () => void;
  run: (action: () => void) => void;
}) {
  const [companyId, setCompanyId] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [companyStatus, setCompanyStatus] = useState<ContractorCompanyStatus>('active');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [userId, setUserId] = useState('');
  const [userName, setUserName] = useState('');
  const [userPhone, setUserPhone] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [accessExpiresAt, setAccessExpiresAt] = useState('');
  const [importRows, setImportRows] = useState('[{"company_name":"Чистый Дом","user_full_name":"Петр Подрядчик"}]');

  const getCompany = useMutation({
    mutationFn: () => api.contractors.getCompanyById(companyId.trim()),
  });
  const createCompany = useMutation({
    mutationFn: () => api.contractors.createCompany({
      property_id: propertyId,
      name: companyName.trim() || 'Новая компания',
      contact_name: contactName.trim() || null,
      contact_phone: contactPhone.trim() || null,
      contact_email: contactEmail.trim() || null,
    }),
    onSuccess: invalidate,
  });
  const updateCompany = useMutation({
    mutationFn: () => api.contractors.updateCompany(companyId.trim(), {
      name: companyName.trim() || undefined,
      status: companyStatus,
      contact_name: contactName.trim() || null,
      contact_phone: contactPhone.trim() || null,
      contact_email: contactEmail.trim() || null,
    }),
    onSuccess: invalidate,
  });
  const createUser = useMutation({
    mutationFn: () => api.contractors.createUser({
      property_id: propertyId,
      contractor_company_id: companyId.trim(),
      full_name: userName.trim() || 'Новый подрядчик',
      phone: userPhone.trim() || null,
      email: userEmail.trim() || null,
      specialization: specialization.trim() || null,
      access_expires_at: accessExpiresAt.trim() || null,
    }),
    onSuccess: invalidate,
  });
  const updateUser = useMutation({
    mutationFn: () => api.contractors.updateUser(userId.trim(), {
      full_name: userName.trim() || undefined,
      phone: userPhone.trim() || null,
      email: userEmail.trim() || null,
      specialization: specialization.trim() || null,
      access_expires_at: accessExpiresAt.trim() || null,
    }),
    onSuccess: invalidate,
  });
  const deactivateUser = useMutation({
    mutationFn: () => api.contractors.deactivateUser(userId.trim()),
    onSuccess: invalidate,
  });
  const previewContractorImport = useMutation({
    mutationFn: () => api.contractors.previewImport({
      property_id: propertyId,
      rows: parseRows<ContractorImportRowInput>(importRows, []),
    }),
  });
  const applyContractorImport = useMutation({
    mutationFn: () => api.contractors.applyImport({
      property_id: propertyId,
      rows: parseRows<ContractorImportRowInput>(importRows, []),
    }),
    onSuccess: invalidate,
  });
  const contractorTemplateUrl = api.contractors.importTemplateUrl();

  return (
    <Stack>
      <Card title="Операции подрядчиков" subtitle="Компании, пользователи, detail и imports.">
        <Stack>
          <div className={uiClasses.formGrid}>
            <Field label="Company ID">
              <Input value={companyId} onChange={(event) => setCompanyId(event.currentTarget.value)} placeholder="company-uuid" />
            </Field>
            <Field label="Company name">
              <Input value={companyName} onChange={(event) => setCompanyName(event.currentTarget.value)} placeholder="Чистый Дом" />
            </Field>
            <Field label="Company status">
              <Select value={companyStatus} onChange={(event) => setCompanyStatus(event.currentTarget.value as ContractorCompanyStatus)}>
                {COMPANY_STATUSES.map((item) => <option key={item} value={item}>{companyStatusLabel(item)}</option>)}
              </Select>
            </Field>
            <Field label="Contact name">
              <Input value={contactName} onChange={(event) => setContactName(event.currentTarget.value)} placeholder="Петр" />
            </Field>
            <Field label="Contact phone">
              <Input value={contactPhone} onChange={(event) => setContactPhone(event.currentTarget.value)} placeholder="+79990000002" />
            </Field>
            <Field label="Contact email">
              <Input value={contactEmail} onChange={(event) => setContactEmail(event.currentTarget.value)} placeholder="clean@example.test" />
            </Field>
          </div>
          <Inline>
            <Button variant="secondary" loading={getCompany.isPending} onClick={() => getCompany.mutate()}>Загрузить компанию</Button>
            <Button loading={createCompany.isPending} onClick={() => createCompany.mutate()}>Создать компанию</Button>
            <Button variant="secondary" loading={updateCompany.isPending} onClick={() => updateCompany.mutate()}>Обновить компанию</Button>
          </Inline>
          {getCompany.data ? <Alert tone="info">Компания загружена: {getCompany.data.company.name}</Alert> : null}

          <div className={uiClasses.formGrid}>
            <Field label="Contractor user ID">
              <Input value={userId} onChange={(event) => setUserId(event.currentTarget.value)} placeholder="contractor-user-uuid" />
            </Field>
            <Field label="User full name">
              <Input value={userName} onChange={(event) => setUserName(event.currentTarget.value)} placeholder="Петр Подрядчик" />
            </Field>
            <Field label="User phone">
              <Input value={userPhone} onChange={(event) => setUserPhone(event.currentTarget.value)} placeholder="+79990000002" />
            </Field>
            <Field label="User email">
              <Input value={userEmail} onChange={(event) => setUserEmail(event.currentTarget.value)} placeholder="petr@example.test" />
            </Field>
            <Field label="Specialization">
              <Input value={specialization} onChange={(event) => setSpecialization(event.currentTarget.value)} placeholder="cleaning" />
            </Field>
            <Field label="Access expires at">
              <Input value={accessExpiresAt} onChange={(event) => setAccessExpiresAt(event.currentTarget.value)} placeholder="2026-06-01T00:00:00.000Z" />
            </Field>
          </div>
          <Inline>
            <Button loading={createUser.isPending} onClick={() => createUser.mutate()}>Создать пользователя</Button>
            <Button variant="secondary" loading={updateUser.isPending} onClick={() => updateUser.mutate()}>Обновить пользователя</Button>
            <Button variant="danger" loading={deactivateUser.isPending} onClick={() => deactivateUser.mutate()}>Деактивировать пользователя</Button>
            <Button variant="ghost" onClick={() => window.location.assign(contractorTemplateUrl)}>CSV template</Button>
          </Inline>

          <Field label="Contractor import rows JSON">
            <Textarea value={importRows} onChange={(event) => setImportRows(event.currentTarget.value)} rows={3} />
          </Field>
          <Inline>
            <Button variant="secondary" loading={previewContractorImport.isPending} onClick={() => run(() => previewContractorImport.mutate())}>Preview contractor import</Button>
            <Button variant="secondary" loading={applyContractorImport.isPending} onClick={() => run(() => applyContractorImport.mutate())}>Apply contractor import</Button>
          </Inline>
        </Stack>
      </Card>

      <div className={uiClasses.twoColumn}>
      <Card title="Компании" subtitle={companyHint}>
        {companies.length ? (
          <ul className={uiClasses.resourceList}>
            {companies.map((company) => (
              <li key={company.id} className={uiClasses.resourceRow}>
                <div className={uiClasses.resourceRowMain}>
                  <p className={uiClasses.resourceTitle}>{company.name}</p>
                  <div className={uiClasses.resourceMeta}>
                    <span>{company.contact_name || 'контакт —'}</span>
                    <span>{company.contact_phone || 'телефон —'}</span>
                    <span>{company.contact_email || 'email —'}</span>
                    <span>активных пользователей {formatNumber(company.active_users_count ?? 0)}</span>
                  </div>
                </div>
                <Badge tone={statusTone(company.status)}>{companyStatusLabel(company.status)}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>Компании подрядчиков не найдены.</EmptyState>
        )}
        {companiesHasMore ? (
          <LoadMoreButton loading={companiesLoadingMore} onClick={onLoadMoreCompanies}>
            Показать ещё компании
          </LoadMoreButton>
        ) : null}
      </Card>

      <Card title="Пользователи подрядчиков" subtitle={userHint}>
        {users.length ? (
          <ul className={uiClasses.resourceList}>
            {users.map((user) => (
              <li key={user.id} className={uiClasses.resourceRow}>
                <div className={uiClasses.resourceRowMain}>
                  <p className={uiClasses.resourceTitle}>{user.full_name}</p>
                  <div className={uiClasses.resourceMeta}>
                    <span>{user.specialization || 'специализация —'}</span>
                    <span>{user.email || 'email —'}</span>
                    <span>{user.phone || 'телефон —'}</span>
                    <span>доступ до {formatDateTime(user.access_expires_at)}</span>
                  </div>
                </div>
                <Badge tone={user.is_active ? 'success' : 'neutral'}>
                  {user.is_active ? 'активен' : 'неактивен'}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>Пользователи подрядчиков не найдены.</EmptyState>
        )}
        {usersHasMore ? (
          <LoadMoreButton loading={usersLoadingMore} onClick={onLoadMoreUsers}>
            Показать ещё пользователей
          </LoadMoreButton>
        ) : null}
      </Card>
      </div>
    </Stack>
  );
}

function MembershipsTab({
  memberships,
  pageHint,
  hasMore,
  loadingMore,
  onLoadMore,
  propertyId,
  invalidate,
}: {
  memberships: RoleScopeMembership[];
  pageHint: string;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  propertyId: string;
  invalidate: () => void;
}) {
  const [membershipId, setMembershipId] = useState('');
  const [subjectType, setSubjectType] = useState<MembershipSubjectType>('staff');
  const [subjectId, setSubjectId] = useState('');
  const [role, setRole] = useState<UserRole>('concierge');
  const [scopeLevel, setScopeLevel] = useState<MembershipScopeLevel>('property');
  const [scopeId, setScopeId] = useState('');
  const [reason, setReason] = useState('');

  const mineMemberships = useMutation({
    mutationFn: () => api.memberships.listMine(),
  });
  const createMembership = useMutation({
    mutationFn: () => api.memberships.create({
      property_id: propertyId,
      subject_type: subjectType,
      subject_id: subjectId.trim() || null,
      resident_id: subjectType === 'resident' ? subjectId.trim() : null,
      staff_user_id: subjectType === 'staff' ? subjectId.trim() : null,
      contractor_user_id: subjectType === 'contractor' ? subjectId.trim() : null,
      external_subject_type: subjectType === 'external' ? 'external' : null,
      external_subject_id: subjectType === 'external' ? subjectId.trim() : null,
      role,
      scope_level: scopeLevel,
      scope_id: scopeId.trim() || null,
      provisioned_from: 'directory_admin_ui',
    }),
    onSuccess: invalidate,
  });
  const revokeMembership = useMutation({
    mutationFn: () => api.memberships.revoke(membershipId.trim(), { reason: reason.trim() || null }),
    onSuccess: invalidate,
  });

  return (
    <Stack>
      <Card title="Операции членств" subtitle="List mine, create и revoke role-scope memberships.">
        <Stack>
          <div className={uiClasses.formGrid}>
            <Field label="Membership ID">
              <Input value={membershipId} onChange={(event) => setMembershipId(event.currentTarget.value)} placeholder="membership-uuid" />
            </Field>
            <Field label="Subject type">
              <Select value={subjectType} onChange={(event) => setSubjectType(event.currentTarget.value as MembershipSubjectType)}>
                {MEMBERSHIP_SUBJECT_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Field>
            <Field label="Subject ID">
              <Input value={subjectId} onChange={(event) => setSubjectId(event.currentTarget.value)} placeholder="subject-uuid" />
            </Field>
            <Field label="Role">
              <Select value={role} onChange={(event) => setRole(event.currentTarget.value as UserRole)}>
                {MEMBERSHIP_ROLES.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Field>
            <Field label="Scope level">
              <Select value={scopeLevel} onChange={(event) => setScopeLevel(event.currentTarget.value as MembershipScopeLevel)}>
                {MEMBERSHIP_SCOPE_LEVELS.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Field>
            <Field label="Scope ID">
              <Input value={scopeId} onChange={(event) => setScopeId(event.currentTarget.value)} placeholder="scope-uuid" />
            </Field>
            <Field label="Revoke reason">
              <Input value={reason} onChange={(event) => setReason(event.currentTarget.value)} placeholder="Роль больше не нужна" />
            </Field>
          </div>
          <Inline>
            <Button variant="secondary" loading={mineMemberships.isPending} onClick={() => mineMemberships.mutate()}>Мои членства</Button>
            <Button loading={createMembership.isPending} onClick={() => createMembership.mutate()}>Создать членство</Button>
            <Button variant="danger" loading={revokeMembership.isPending} onClick={() => revokeMembership.mutate()}>Отозвать членство</Button>
          </Inline>
          {mineMemberships.data ? <Alert tone="info">Моих членств: {formatNumber(mineMemberships.data.memberships.length)}</Alert> : null}
        </Stack>
      </Card>

      <Card title="Role-scope членства" subtitle={pageHint}>
      {memberships.length ? (
        <Stack>
          <ul className={uiClasses.resourceList}>
            {memberships.map((membership) => (
              <li key={membership.id} className={uiClasses.resourceRow}>
                <div className={uiClasses.resourceRowMain}>
                  <p className={uiClasses.resourceTitle}>{membershipSubjectLabel(membership)}</p>
                  <div className={uiClasses.resourceMeta}>
                    <span>роль {membership.role}</span>
                    <span>scope {membership.scope_level}</span>
                    <span>scope id {idShort(membership.scope_id)}</span>
                    <span>создано {formatDateTime(membership.created_at)}</span>
                    <span>источник {membership.provisioned_from || '—'}</span>
                  </div>
                </div>
                <Badge tone={statusTone(membership.status)}>
                  {membershipStatusLabel(membership.status)}
                </Badge>
              </li>
            ))}
          </ul>
        </Stack>
      ) : (
        <EmptyState>Членства не найдены.</EmptyState>
      )}
      {hasMore ? (
        <LoadMoreButton loading={loadingMore} onClick={onLoadMore}>
          Показать ещё членства
        </LoadMoreButton>
      ) : null}
      </Card>
    </Stack>
  );
}

function membershipSubjectLabel(membership: RoleScopeMembership): string {
  if (membership.resident_id) return `Житель ${idShort(membership.resident_id)}`;
  if (membership.staff_user_id) return `Сотрудник ${idShort(membership.staff_user_id)}`;
  if (membership.contractor_user_id) return `Подрядчик ${idShort(membership.contractor_user_id)}`;
  if (membership.external_subject_id) {
    return `${membership.external_subject_type || 'external'} ${idShort(membership.external_subject_id)}`;
  }
  return `Membership ${idShort(membership.id)}`;
}
