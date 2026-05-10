/**
 * ResidentAnnouncementsFeedPage — published announcements feed (/v1/my/announcements).
 *
 * Backend: GET /announcements — backend filters by the resident's property
 * and excludes drafts/deleted/expired.  `only_active=true` is an additional
 * hint that also drops not-yet-started scheduled posts (starts_at > now).
 *
 * Read-only: residents cannot interact beyond reading.  We pin urgent +
 * is_pinned posts on top, surface urgent items in a banner, and render
 * `body_md` as plain preformatted text.
 * Rendering markdown properly is a separate feature (needs a sanitizer on
 * the frontend, mirrored from backend's markdownSanitizer) — for now,
 * preformatted `<pre>` keeps line breaks intact without XSS risk.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, isV1ApiError } from '../api';
import type { Announcement, AnnouncementCategory } from '../api/types';
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

// Labels are typed against the exact enum so a new backend category breaks
// compilation instead of silently falling back to the raw slug.  Capitalised
// form for the resident feed (admin UI uses lowercase in a compact table).
const CATEGORY_LABELS: Record<AnnouncementCategory, string> = {
  general: 'Общее',
  maintenance: 'Обслуживание',
  event: 'Событие',
  emergency: 'Аварийное',
  marketing: 'Маркетинг',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ResidentAnnouncementsFeedPage() {
  const query = useQuery({
    queryKey: qk.announcements.list({ only_active: true }),
    queryFn: () => api.announcements.list({ only_active: true }),
    staleTime: 60_000,
  });

  const sorted = useMemo(() => {
    const rows = query.data?.announcements ?? [];
    // Pinned + urgent first, then newest (by starts_at which is what the
    // resident perceives as "the date of the post").
    return [...rows].sort((a, b) => {
      const pinA = a.is_pinned ? 1 : 0;
      const pinB = b.is_pinned ? 1 : 0;
      if (pinA !== pinB) return pinB - pinA;
      const urgA = a.is_urgent ? 1 : 0;
      const urgB = b.is_urgent ? 1 : 0;
      if (urgA !== urgB) return urgB - urgA;
      return new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime();
    });
  }, [query.data]);

  const urgentRows = useMemo(
    () => sorted.filter((row) => row.is_urgent),
    [sorted],
  );

  return (
    <div className={uiClasses.pageShell}>
      <header className={uiClasses.pageHeader}>
        <ResidentNav />
        <h1 className={uiClasses.pageTitle}>Объявления</h1>
        <p className={uiClasses.pageSubtitle}>
          Уведомления от управляющей компании и консьерж-службы.
        </p>
      </header>

      <Stack>
        {query.isLoading && (
          <Inline>
            <Spinner />
            <span className={uiClasses.textMuted}>Загружаем ленту…</span>
          </Inline>
        )}

        {query.isError && (
          <Alert tone="error">
            Не удалось загрузить объявления:{' '}
            {isV1ApiError(query.error)
              ? query.error.message
              : 'неизвестная ошибка'}
          </Alert>
        )}

        {query.isSuccess && sorted.length === 0 && (
          <EmptyState>Пока нет активных объявлений.</EmptyState>
        )}

        {urgentRows.length > 0 && (
          <section
            role="region"
            className={`${uiClasses.alert} ${uiClasses.alertWarning}`}
            aria-labelledby="resident-urgent-announcements"
          >
            <h2 id="resident-urgent-announcements" className={uiClasses.sectionHeading}>
              Срочные объявления
            </h2>
            <ul className={`${uiClasses.resourceList} ${uiClasses.marginTop3}`}>
              {urgentRows.map((row) => (
                <li key={row.id} className={uiClasses.resourceRow}>
                  <div className={uiClasses.resourceRowMain}>
                    <p className={uiClasses.resourceTitle}>{row.title}</p>
                    <p className={uiClasses.resourceMeta}>
                      {CATEGORY_LABELS[row.category] ?? row.category}
                      {' · '}
                      {formatDate(row.published_at ?? row.starts_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {sorted.map((row) => (
          <AnnouncementCard key={row.id} row={row} />
        ))}
      </Stack>
    </div>
  );
}

function AnnouncementCard({ row }: { row: Announcement }) {
  const categoryLabel = CATEGORY_LABELS[row.category] ?? row.category;
  return (
    <Card
      title={row.title}
      subtitle={`${formatDate(row.published_at ?? row.starts_at)} · ${categoryLabel}`}
      actions={
        <Inline>
          {row.is_pinned && <Badge tone="info">Закреплено</Badge>}
          {row.is_urgent && <Badge tone="error">Срочно</Badge>}
        </Inline>
      }
      elevated={row.is_urgent || row.is_pinned}
    >
      <pre className={uiClasses.preWrap}>{row.body_md}</pre>
      {row.expires_at && (
        <p className={`${uiClasses.textMuted} ${uiClasses.marginTop3}`}>
          Действительно до {formatDate(row.expires_at)}
        </p>
      )}
    </Card>
  );
}
