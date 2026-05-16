import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, isV1ApiError } from '../api';
import type { NotificationLogRow } from '../api/types';
import { ResidentNav } from '../components/ResidentNav';
import { formatDateTime } from '../components/formatters';
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
import type { BadgeTone } from '../components/ui';

const LIMIT = 50;

function statusTone(status: NotificationLogRow['status']): BadgeTone {
  return status === 'sent' ? 'success' : 'warning';
}

function formatRecipient(row: NotificationLogRow): string {
  if (row.recipient_address) return row.recipient_address;
  return row.recipient_id ?? 'адрес скрыт';
}

export function ResidentNotificationsPage() {
  const query = useQuery({
    queryKey: ['v1', 'notification-log', 'mine', LIMIT],
    queryFn: ({ signal }) => api.notificationLog.mine(LIMIT, { signal }),
    staleTime: 30_000,
  });

  const rows = useMemo(() => query.data?.items ?? [], [query.data]);

  return (
    <div className={uiClasses.pageShell}>
      <header className={uiClasses.pageHeader}>
        <ResidentNav />
        <h1 className={uiClasses.pageTitle}>Мои уведомления</h1>
        <p className={uiClasses.pageSubtitle}>
          Последние delivery-события, отправленные на ваши каналы связи.
        </p>
      </header>

      <Stack>
        {query.isLoading ? (
          <Inline>
            <Spinner />
            <span className={uiClasses.textMuted}>Загружаем уведомления…</span>
          </Inline>
        ) : null}

        {query.isError ? (
          <Alert tone="error">
            Не удалось загрузить уведомления:{' '}
            {isV1ApiError(query.error) ? query.error.message : 'неизвестная ошибка'}
          </Alert>
        ) : null}

        {query.isSuccess && rows.length === 0 ? (
          <EmptyState>У вас пока нет уведомлений.</EmptyState>
        ) : null}

        {rows.length ? (
          <Card title="История уведомлений">
            <ul className={uiClasses.resourceList}>
              {rows.map((row) => (
                <li className={uiClasses.resourceRow} key={row.id}>
                  <div className={uiClasses.resourceRowMain}>
                    <Inline>
                      <p className={uiClasses.resourceTitle}>{row.event_type}</p>
                      <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                      <Badge tone="neutral">{row.channel}</Badge>
                    </Inline>
                    <p className={uiClasses.resourceMeta}>
                      {formatRecipient(row)} · {formatDateTime(row.created_at)}
                    </p>
                    {row.sent_at ? (
                      <p className={uiClasses.textMuted}>Отправлено {formatDateTime(row.sent_at)}</p>
                    ) : null}
                    {row.error_code || row.error_message ? (
                      <Alert tone="warning">
                        {row.error_code || 'provider_error'}
                        {row.error_message ? ` · ${row.error_message}` : ''}
                      </Alert>
                    ) : null}
                  </div>
                  <Badge tone={row.status === 'sent' ? 'success' : 'warning'}>
                    attempts {row.attempt_count}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </Stack>
    </div>
  );
}
