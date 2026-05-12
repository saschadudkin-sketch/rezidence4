import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, isV1ApiError } from '../api';
import type { GisOssExportPackage, GisOssExportPayload, GisOssPackageType, UUID } from '../api';
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

const PACKAGE_TYPES: Array<{ value: GisOssPackageType; label: string }> = [
  { value: 'oss_readiness', label: 'ОСС readiness' },
  { value: 'gis_zhkh', label: 'GIS ЖКХ' },
  { value: 'resident_notice', label: 'Уведомление жителей' },
  { value: 'protocol_archive', label: 'Архив протоколов' },
];

function splitIds(value: string): UUID[] {
  return value
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean) as UUID[];
}

function splitOperationalRefs(value: string) {
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [type, id, ...noteParts] = line.split(':').map((item) => item.trim());
      return { type, id, note: noteParts.join(':') || null };
    })
    .filter((item) => item.type && item.id);
}

function packageTypeLabel(value: GisOssPackageType): string {
  return PACKAGE_TYPES.find((item) => item.value === value)?.label ?? value;
}

function errorMessage(error: unknown): string {
  return isV1ApiError(error) ? error.message : 'Неизвестная ошибка';
}

function asGisOssPayload(value: GisOssExportPackage['export_payload']): GisOssExportPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof (value as GisOssExportPayload).format_version !== 'string') return null;
  return value as GisOssExportPayload;
}

export function GisOssReadinessPage() {
  const session = useV1Session();
  const propertyId = session.property_id as UUID | null;
  const queryClient = useQueryClient();
  const [packageType, setPackageType] = useState<GisOssPackageType>('oss_readiness');
  const [title, setTitle] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [documentIds, setDocumentIds] = useState('');
  const [announcementIds, setAnnouncementIds] = useState('');
  const [protocolLabel, setProtocolLabel] = useState('');
  const [protocolUrl, setProtocolUrl] = useState('');
  const [operationalRefs, setOperationalRefs] = useState('');

  const listParams = useMemo(
    () => propertyId ? { property_id: propertyId, limit: 25 } : null,
    [propertyId],
  );

  const boundaryQuery = useQuery({
    queryKey: ['v1', 'gis-oss', 'boundary'],
    queryFn: ({ signal }) => api.gisOssReadiness.getBoundary({ signal }),
  });

  const packagesQuery = useQuery({
    queryKey: ['v1', 'gis-oss', 'packages', listParams],
    enabled: Boolean(listParams),
    queryFn: ({ signal }) => api.gisOssReadiness.listExportPackages(listParams!, { signal }),
  });

  const createMutation = useMutation({
    mutationFn: () => {
      if (!propertyId) throw new Error('property_id is missing');
      const protocolFiles = protocolUrl.trim()
        ? [{ label: protocolLabel.trim() || 'protocol', file_url: protocolUrl.trim() }]
        : [];
      return api.gisOssReadiness.createExportPackage({
        property_id: propertyId,
        package_type: packageType,
        title: title.trim(),
        period_start: periodStart || null,
        period_end: periodEnd || null,
        document_ids: splitIds(documentIds),
        announcement_ids: splitIds(announcementIds),
        protocol_files: protocolFiles,
        operational_record_refs: splitOperationalRefs(operationalRefs),
      });
    },
    onSuccess: async () => {
      setTitle('');
      setDocumentIds('');
      setAnnouncementIds('');
      setProtocolLabel('');
      setProtocolUrl('');
      setOperationalRefs('');
      await queryClient.invalidateQueries({ queryKey: ['v1', 'gis-oss', 'packages'] });
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createMutation.mutate();
  }

  if (!propertyId) {
    return (
      <div className={uiClasses.pageShell}>
        <header className={uiClasses.pageHeader}>
          <h1 className={uiClasses.pageTitle}>GIS ЖКХ / ОСС</h1>
        </header>
        <Alert tone="warning">Администратор не привязан к объекту.</Alert>
      </div>
    );
  }

  const packages = packagesQuery.data?.export_packages ?? [];
  const boundaryNotice = boundaryQuery.data?.notice
    ?? packagesQuery.data?.boundary_notice
    ?? 'Экспортный пакет не является сертифицированной подачей GIS ЖКХ или юридически значимым электронным голосованием ОСС.';

  return (
    <div className={uiClasses.pageShell}>
      <header className={uiClasses.pageHeader}>
        <h1 className={uiClasses.pageTitle}>GIS ЖКХ / ОСС</h1>
        <p className={uiClasses.pageSubtitle}>Пакеты готовности для документов, объявлений и протоколов.</p>
      </header>

      <Stack>
        <Alert tone="warning">{boundaryNotice}</Alert>

        <Card title="Новый пакет" subtitle="Материалы сохраняются как readiness/export, без юридической подачи.">
          <form onSubmit={handleSubmit}>
            <div className={uiClasses.formGrid}>
              <Field id="gis-oss-package-type" label="Тип">
                <Select
                  id="gis-oss-package-type"
                  value={packageType}
                  onChange={(event) => setPackageType(event.target.value as GisOssPackageType)}
                >
                  {PACKAGE_TYPES.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </Select>
              </Field>

              <Field id="gis-oss-title" label="Название">
                <Input
                  id="gis-oss-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  required
                />
              </Field>

              <Field id="gis-oss-period-start" label="Период с">
                <Input
                  id="gis-oss-period-start"
                  type="date"
                  value={periodStart}
                  onChange={(event) => setPeriodStart(event.target.value)}
                />
              </Field>

              <Field id="gis-oss-period-end" label="Период по">
                <Input
                  id="gis-oss-period-end"
                  type="date"
                  value={periodEnd}
                  onChange={(event) => setPeriodEnd(event.target.value)}
                />
              </Field>

              <Field id="gis-oss-documents" label="Document IDs" className={uiClasses.formGridWide}>
                <Textarea
                  id="gis-oss-documents"
                  value={documentIds}
                  onChange={(event) => setDocumentIds(event.target.value)}
                />
              </Field>

              <Field id="gis-oss-announcements" label="Announcement IDs" className={uiClasses.formGridWide}>
                <Textarea
                  id="gis-oss-announcements"
                  value={announcementIds}
                  onChange={(event) => setAnnouncementIds(event.target.value)}
                />
              </Field>

              <Field id="gis-oss-protocol-label" label="Протокол">
                <Input
                  id="gis-oss-protocol-label"
                  value={protocolLabel}
                  onChange={(event) => setProtocolLabel(event.target.value)}
                />
              </Field>

              <Field id="gis-oss-protocol-url" label="Файл протокола">
                <Input
                  id="gis-oss-protocol-url"
                  value={protocolUrl}
                  onChange={(event) => setProtocolUrl(event.target.value)}
                  placeholder="/uploads/..."
                />
              </Field>

              <Field id="gis-oss-operational-refs" label="Операционные ссылки" className={uiClasses.formGridWide}>
                <Textarea
                  id="gis-oss-operational-refs"
                  value={operationalRefs}
                  onChange={(event) => setOperationalRefs(event.target.value)}
                />
              </Field>
            </div>

            <Inline>
              <Button type="submit" loading={createMutation.isPending} disabled={!title.trim()}>
                Сформировать пакет
              </Button>
              {createMutation.isError ? (
                <span className={uiClasses.fieldError}>{errorMessage(createMutation.error)}</span>
              ) : null}
              {createMutation.isSuccess ? (
                <span className={uiClasses.textMuted}>Пакет сформирован.</span>
              ) : null}
            </Inline>
          </form>
        </Card>

        <Card title="Пакеты" subtitle="Последние readiness/export пакеты объекта.">
          {packagesQuery.isLoading ? (
            <Inline><Spinner /><span className={uiClasses.textMuted}>Загрузка...</span></Inline>
          ) : null}
          {packagesQuery.isError ? (
            <Alert tone="error">Не удалось загрузить пакеты: {errorMessage(packagesQuery.error)}</Alert>
          ) : null}
          {!packagesQuery.isLoading && !packages.length ? (
            <EmptyState>Пакетов пока нет.</EmptyState>
          ) : null}
          {packages.length ? <PackageList rows={packages} /> : null}
        </Card>
      </Stack>
    </div>
  );
}

function PackageList({ rows }: { rows: GisOssExportPackage[] }) {
  return (
    <ul className={uiClasses.resourceList}>
      {rows.map((row) => {
        const payload = asGisOssPayload(row.export_payload);
        const artifact = payload?.packaging;
        const digest = artifact?.manifest.package_payload_sha256;
        const artifactHref = `/api/v1/gis-oss/export-packages/${row.id}/artifact?property_id=${row.property_id}`;
        return (
          <li key={row.id} className={uiClasses.resourceRow}>
            <div className={uiClasses.resourceRowMain}>
              <h3 className={uiClasses.resourceTitle}>{row.title}</h3>
              <div className={uiClasses.resourceMeta}>
                <span>{packageTypeLabel(row.package_type)}</span>
                <span>{formatDateTime(row.generated_at)}</span>
                <span>{row.document_ids.length} docs</span>
                <span>{row.announcement_ids.length} announcements</span>
                {artifact ? <span>{artifact.artifact_filename}</span> : null}
                {digest ? <span>sha256 {digest.slice(0, 12)}</span> : null}
              </div>
            </div>
            <Inline>
              <a href={artifactHref}>Скачать JSON</a>
              <Badge tone={row.certified_submission ? 'error' : 'warning'}>
                {row.certified_submission ? 'Certified' : 'Readiness'}
              </Badge>
              <Badge tone={row.legally_authoritative ? 'error' : 'neutral'}>
                {row.legally_authoritative ? 'Legal' : 'Non-authoritative'}
              </Badge>
            </Inline>
          </li>
        );
      })}
    </ul>
  );
}
