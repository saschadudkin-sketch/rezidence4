import { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  api,
  isV1ApiError,
  type Building,
  type ContractorCompany,
  type ContractorCompanyStatus,
  type ContractorUser,
  type Entrance,
  type MembershipStatus,
  type ResidentWithUnit,
  type RoleScopeMembership,
  type StaffRole,
  type StaffUser,
  type Unit,
} from '../api';
import { useV1Session } from '../store';
import { formatDateTime } from '../components/formatters';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Field,
  Inline,
  Input,
  Spinner,
  Stack,
  uiClasses,
} from '../components/ui';
import type { BadgeTone } from '../components/ui';
import { formatUnitLabel, getPropertyLabels } from '../lib/propertyLabels';

type DirectoryTab = 'structure' | 'residents' | 'staff' | 'contractors' | 'memberships';

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

const LIMIT = 50;

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

export function PropertyDirectoryAdminPage() {
  const session = useV1Session();
  const labels = useMemo(() => getPropertyLabels(session.property_type), [session.property_type]);
  const propertyId = session.property_id ?? null;
  const [tab, setTab] = useState<DirectoryTab>('structure');
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim();

  const buildingsQuery = useQuery({
    queryKey: ['v1', 'directory', propertyId, 'buildings'],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.units.listBuildings({ signal }),
  });

  const unitsQuery = useQuery({
    queryKey: ['v1', 'directory', propertyId, 'units', normalizedQuery],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.units.list({
      is_active: true,
      limit: LIMIT,
      q: normalizedQuery || undefined,
    }, { signal }),
  });

  const residentsQuery = useQuery({
    queryKey: ['v1', 'directory', propertyId, 'residents', normalizedQuery],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.residents.list({
      is_active: true,
      limit: LIMIT,
      q: normalizedQuery || undefined,
    }, { signal }),
  });

  const staffQuery = useQuery({
    queryKey: ['v1', 'directory', propertyId, 'staff', normalizedQuery],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.staff.list({
      is_active: true,
      limit: LIMIT,
      q: normalizedQuery || undefined,
    }, { signal }),
  });

  const companiesQuery = useQuery({
    queryKey: ['v1', 'directory', propertyId, 'contractor-companies', normalizedQuery],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.contractors.listCompanies({
      status: 'active',
      limit: LIMIT,
      q: normalizedQuery || undefined,
    }, { signal }),
  });

  const contractorUsersQuery = useQuery({
    queryKey: ['v1', 'directory', propertyId, 'contractor-users'],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.contractors.listUsers({
      is_active: true,
      limit: LIMIT,
    }, { signal }),
  });

  const membershipsQuery = useQuery({
    queryKey: ['v1', 'directory', propertyId, 'memberships'],
    enabled: Boolean(propertyId),
    queryFn: ({ signal }) => api.memberships.list({
      property_id: propertyId ?? '',
      limit: LIMIT,
    }, { signal }),
  });

  const buildings = buildingsQuery.data?.buildings ?? [];
  const entranceQueries = useQueries({
    queries: buildings.slice(0, 12).map((building) => ({
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
            placeholder="ФИО, email, юнит или подрядчик"
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
          units={unitsQuery.data?.units ?? []}
          unitPageHint={pageHint(unitsQuery.data?.page, unitsQuery.data?.units.length ?? 0)}
          propertyType={session.property_type}
        />
      ) : null}
      {tab === 'residents' ? (
        <ResidentsTab
          residents={residentsQuery.data?.residents ?? []}
          pageHint={pageHint(residentsQuery.data?.page, residentsQuery.data?.residents.length ?? 0)}
        />
      ) : null}
      {tab === 'staff' ? (
        <StaffTab
          staff={staffQuery.data?.staff ?? []}
          pageHint={pageHint(staffQuery.data?.page, staffQuery.data?.staff.length ?? 0)}
        />
      ) : null}
      {tab === 'contractors' ? (
        <ContractorsTab
          companies={companiesQuery.data?.companies ?? []}
          users={contractorUsersQuery.data?.users ?? []}
          companyHint={pageHint(companiesQuery.data?.page, companiesQuery.data?.companies.length ?? 0)}
          userHint={pageHint(contractorUsersQuery.data?.page, contractorUsersQuery.data?.users.length ?? 0)}
        />
      ) : null}
      {tab === 'memberships' ? (
        <MembershipsTab
          memberships={membershipsQuery.data?.memberships ?? []}
          pageHint={pageHint(membershipsQuery.data?.page, membershipsQuery.data?.memberships.length ?? 0)}
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

function StructureTab({
  buildings,
  entranceQueries,
  units,
  unitPageHint,
  propertyType,
}: {
  buildings: Building[];
  entranceQueries: Entrance[][];
  units: Unit[];
  unitPageHint: string;
  propertyType: unknown;
}) {
  return (
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
                    <span>входов {formatNumber(entranceQueries[index]?.length ?? 0)}</span>
                  </div>
                </div>
                <Badge>{idShort(building.id)}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>Корпуса не найдены.</EmptyState>
        )}
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
      </Card>
    </div>
  );
}

function ResidentsTab({ residents, pageHint }: { residents: ResidentWithUnit[]; pageHint: string }) {
  return (
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
    </Card>
  );
}

function StaffTab({ staff, pageHint }: { staff: StaffUser[]; pageHint: string }) {
  return (
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
    </Card>
  );
}

function ContractorsTab({
  companies,
  users,
  companyHint,
  userHint,
}: {
  companies: ContractorCompany[];
  users: ContractorUser[];
  companyHint: string;
  userHint: string;
}) {
  return (
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
      </Card>
    </div>
  );
}

function MembershipsTab({
  memberships,
  pageHint,
}: {
  memberships: RoleScopeMembership[];
  pageHint: string;
}) {
  return (
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
    </Card>
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
