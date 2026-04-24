/**
 * ResidentDocumentsPage — published documents for the resident's property
 * (/v1/my/documents).
 *
 * Backend: GET /documents — the service's listForResident branch filters
 * to published_at IS NOT NULL AND deleted_at IS NULL AND property derived
 * from session.  We pass no filters and group client-side by category.
 *
 * Unlike listPublic (/public/:slug/documents), this endpoint returns
 * documents for *authenticated* residents — so legal/contracts documents
 * are visible (not hidden like in public feed).  That matches residency:
 * the resident has a contractual relationship and can see the contract.
 *
 * Read-only.  File downloads use the `/uploads/…` URL as-is; the backend
 * gates access when the signed upload path expires.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, isV1ApiError } from '../api';
import type { DocumentCategory, V1Document } from '../api/types';
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

// Category order shown to residents.  Matches "importance" of the reading
// matter — rules/contacts first, boring-but-important contracts/legal last.
const CATEGORY_ORDER: DocumentCategory[] = [
  'rules',
  'contacts',
  'instructions',
  'safety',
  'contracts',
  'legal',
  'other',
];

const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  rules: 'Правила проживания',
  contacts: 'Контакты',
  instructions: 'Инструкции',
  safety: 'Безопасность',
  contracts: 'Договоры',
  legal: 'Юридические',
  other: 'Прочее',
};

function formatBytes(bytes: number | null): string | null {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

export function ResidentDocumentsPage() {
  const query = useQuery({
    queryKey: qk.documents.list(),
    queryFn: () => api.documents.list(),
    staleTime: 5 * 60_000,
  });

  const grouped = useMemo(() => {
    const rows = query.data?.documents ?? [];
    const map = new Map<DocumentCategory, V1Document[]>();
    for (const r of rows) {
      const list = map.get(r.category) ?? [];
      list.push(r);
      map.set(r.category, list);
    }
    // Sort within each category by sort_order then title.
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return a.title.localeCompare(b.title, 'ru');
      });
    }
    return CATEGORY_ORDER.filter((c) => map.has(c)).map(
      (c) => [c, map.get(c)!] as const,
    );
  }, [query.data]);

  return (
    <div className={uiClasses.pageShell}>
      <header className={uiClasses.pageHeader}>
        <ResidentNav />
        <h1 className={uiClasses.pageTitle}>Документы</h1>
        <p className={uiClasses.pageSubtitle}>
          Правила, договоры, инструкции и контакты управляющей компании.
        </p>
      </header>

      <Stack>
        {query.isLoading && (
          <Inline>
            <Spinner />
            <span className={uiClasses.textMuted}>Загружаем…</span>
          </Inline>
        )}

        {query.isError && (
          <Alert tone="error">
            Не удалось загрузить документы:{' '}
            {isV1ApiError(query.error)
              ? query.error.message
              : 'неизвестная ошибка'}
          </Alert>
        )}

        {query.isSuccess && grouped.length === 0 && (
          <EmptyState>Документы пока не опубликованы.</EmptyState>
        )}

        {grouped.map(([category, rows]) => (
          <section
            key={category}
            aria-labelledby={`cat-${category}`}
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
          >
            <h2
              id={`cat-${category}`}
              style={{ margin: 0, fontSize: 'var(--text-lg)' }}
            >
              {CATEGORY_LABELS[category]}
            </h2>
            {rows.map((row) => (
              <DocumentCard key={row.id} row={row} />
            ))}
          </section>
        ))}
      </Stack>
    </div>
  );
}

function DocumentCard({ row }: { row: V1Document }) {
  const size = formatBytes(row.file_size_bytes);
  return (
    <Card
      title={row.title}
      subtitle={row.tag || undefined}
      actions={row.is_public ? <Badge tone="info">Публичный</Badge> : null}
    >
      <Stack>
        {row.body_md && (
          <pre
            style={{
              margin: 0,
              fontFamily: 'inherit',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {row.body_md}
          </pre>
        )}
        {row.file_url && (
          <p>
            <a href={row.file_url} target="_blank" rel="noopener noreferrer">
              Открыть файл
            </a>
            {size ? <span className={uiClasses.textMuted}> · {size}</span> : null}
            {row.file_mime ? (
              <span className={uiClasses.textMuted}> · {row.file_mime}</span>
            ) : null}
          </p>
        )}
      </Stack>
    </Card>
  );
}
