/**
 * ResidentPackagesPage — resident's own packages (/v1/my/packages).
 *
 * Uses GET /packages/mine, backed by backend/src/v1/routes/packages.js —
 * that route enforces role='resident' and filters by the resident row
 * matched to the JWT uid.  Frontend doesn't need to pass property_id /
 * recipient_resident_id — backend derives both from the session.
 *
 * Read-only: residents cannot create / pickup their own packages via
 * this page (pickup is staff-gated because it requires in-person
 * identity verification at the concierge desk).  We surface packageStatus
 * as a badge and show "ждёт выдачи" items pinned on top to help the
 * resident see what's waiting without scrolling.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, packageStatusTone, isV1ApiError } from '../api';
import type { Package, PackageStatus } from '../api/types';
import { qk } from '../store';
import { ResidentNav } from '../components/ResidentNav';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Inline,
  Spinner,
  Stack,
  uiClasses,
} from '../components/ui';

const STATUS_LABELS: Record<PackageStatus, string> = {
  awaiting_pickup: 'Ждёт выдачи',
  picked_up: 'Получено',
  returned: 'Возвращено',
  lost: 'Потеряно',
};

// Sort order: awaiting_pickup first (actionable), then recent terminals.
const STATUS_PRIORITY: Record<PackageStatus, number> = {
  awaiting_pickup: 0,
  picked_up: 1,
  returned: 2,
  lost: 3,
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function ResidentPackagesPage() {
  const query = useQuery({
    queryKey: qk.packages.mine(),
    queryFn: () => api.packages.listMine(),
    // Packages don't mutate without user action → short stale is fine.
    staleTime: 30_000,
  });

  const sortedPackages = useMemo(() => {
    const rows = query.data?.packages ?? [];
    return [...rows].sort((a, b) => {
      const pa = STATUS_PRIORITY[a.status] ?? 99;
      const pb = STATUS_PRIORITY[b.status] ?? 99;
      if (pa !== pb) return pa - pb;
      // Within same status: newest first.
      return new Date(b.received_at).getTime() - new Date(a.received_at).getTime();
    });
  }, [query.data]);

  return (
    <div className={uiClasses.pageShell}>
      <header className={uiClasses.pageHeader}>
        <ResidentNav />
        <h1 className={uiClasses.pageTitle}>Мои посылки</h1>
        <p className={uiClasses.pageSubtitle}>
          Заберите посылки у консьержа. Статус «Ждёт выдачи» означает, что
          посылка уже в пункте приёма.
        </p>
      </header>

      <Stack>
        {query.isLoading && (
          <Inline>
            <Spinner />
            <span className={uiClasses.textMuted}>Загружаем список…</span>
          </Inline>
        )}

        {query.isError && (
          <Alert tone="error">
            Не удалось загрузить посылки:{' '}
            {isV1ApiError(query.error)
              ? query.error.message
              : 'неизвестная ошибка'}
          </Alert>
        )}

        {query.isSuccess && sortedPackages.length === 0 && (
          <EmptyState>
            У вас пока нет посылок. Когда консьерж примет посылку на ваш адрес,
            она появится здесь.
          </EmptyState>
        )}

        {sortedPackages.map((row) => (
          <PackageCard key={row.id} row={row} />
        ))}
      </Stack>
    </div>
  );
}

function PackageCard({ row }: { row: Package }) {
  const tone = packageStatusTone(row.status);
  const waiting = row.status === 'awaiting_pickup';
  return (
    <div
      data-testid="resident-package-row"
      data-package-id={row.id}
      data-package-status={row.status}
      data-tracking-number={row.tracking_number ?? undefined}
    >
      <Card
        title={row.sender_name || 'Посылка'}
        subtitle={row.tracking_number ? `Трек: ${row.tracking_number}` : undefined}
        actions={<Badge tone={tone}>{STATUS_LABELS[row.status]}</Badge>}
        elevated={waiting}
      >
        <Stack>
          <p className={uiClasses.textMuted}>
            Принято {formatDate(row.received_at)}
            {row.carrier ? ` · курьер: ${row.carrier}` : ''}
            {row.size_category ? ` · размер: ${row.size_category}` : ''}
          </p>
          {waiting && row.storage_location && (
            <p>
              Место хранения: <strong>{row.storage_location}</strong>
            </p>
          )}
          {row.status === 'picked_up' && row.picked_up_at && (
            <p className={uiClasses.textMuted}>
              Получено {formatDate(row.picked_up_at)}
              {row.picked_up_by_name ? ` (${row.picked_up_by_name})` : ''}
            </p>
          )}
          {row.status === 'returned' && (
            <p className={uiClasses.textMuted}>
              Возвращено отправителю{row.returned_at ? ` ${formatDate(row.returned_at)}` : ''}
              {row.returned_reason ? ` · причина: ${row.returned_reason}` : ''}
            </p>
          )}
          {row.status === 'lost' && (
            <Alert tone="error">
              Посылка помечена как потерянная. Свяжитесь с консьержем.
            </Alert>
          )}
          {row.notes && <p className={uiClasses.textMuted}>Заметки: {row.notes}</p>}
        </Stack>
      </Card>
    </div>
  );
}
