'use strict';

const DEFAULT_WINDOW_BEFORE_SECONDS = 20;
const DEFAULT_WINDOW_AFTER_SECONDS = 40;

const SECRET_QUERY_PARAMS = new Set([
  'authorization',
  'auth',
  'password',
  'passwd',
  'pwd',
  'secret',
  'sid',
  'session',
  'sessionid',
  'token',
  'api_key',
  'apikey',
]);

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonObject(value) {
  if (!value) return {};
  if (isPlainObject(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function stripTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function parseDate(value, fallback = null) {
  const raw = firstPresent(value, fallback);
  if (!raw) return null;
  const date = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000);
}

function pad(value, width = 2) {
  return String(value).padStart(width, '0');
}

function isoNoMillis(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function isoLocalNoZone(date) {
  return isoNoMillis(date).replace(/Z$/, '');
}

function compactUtc(date) {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    'T',
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join('');
}

function axxonUtc(date) {
  return `${compactUtc(date)}.${pad(date.getUTCMilliseconds(), 3)}`;
}

function hms(totalSeconds) {
  const normalized = Math.max(1, Math.round(Number(totalSeconds) || 1));
  const hours = Math.floor(normalized / 3600);
  const minutes = Math.floor((normalized % 3600) / 60);
  const seconds = normalized % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function appendQueryToLocalPath(path, query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  if (!Array.from(params.keys()).length) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${params.toString()}`;
}

function sanitizeUrlReference(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  try {
    const isLocalPath = raw.startsWith('/') && !raw.startsWith('//');
    const parsed = new URL(isLocalPath ? `http://domhub.local${raw}` : raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return raw;

    parsed.username = '';
    parsed.password = '';
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (SECRET_QUERY_PARAMS.has(key.toLowerCase())) parsed.searchParams.delete(key);
    }
    if (isLocalPath) return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return parsed.toString();
  } catch {
    return raw;
  }
}

function renderTemplate(template, values) {
  if (!template) return null;
  return String(template).replace(/\{([A-Za-z0-9_.-]+)\}/g, (_match, key) => {
    const value = values[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function normalizeCapabilities(value, defaults = []) {
  if (!Array.isArray(value)) return Array.from(new Set(defaults));
  return Array.from(new Set([...defaults, ...value.map((item) => String(item).trim()).filter(Boolean)]));
}

class VideoProviderAdapter {
  constructor({
    provider = 'generic_link',
    providerConfigId = null,
    propertyId = null,
    displayName = null,
    baseUrl = '',
    authRef = null,
    capabilities = [],
    config = {},
    ...extra
  } = {}) {
    this.provider = provider;
    this.providerConfigId = providerConfigId;
    this.propertyId = propertyId;
    this.displayName = displayName;
    this.baseUrl = stripTrailingSlash(baseUrl || config.baseUrl || config.base_url || '');
    this.authRef = authRef;
    this.config = { ...config, ...extra };
    this.capabilities = new Set(normalizeCapabilities(capabilities, this.defaultCapabilities()));
  }

  defaultCapabilities() {
    return ['event_reference'];
  }

  getCapabilities() {
    return Array.from(this.capabilities).sort();
  }

  supports(capability) {
    return this.capabilities.has(capability);
  }

  getCameraMetadata(camera = {}) {
    return parseJsonObject(camera.metadata);
  }

  getCameraVideoMetadata(camera = {}) {
    const metadata = this.getCameraMetadata(camera);
    return parseJsonObject(metadata.video);
  }

  getCameraId(camera = {}, command = {}) {
    const video = this.getCameraVideoMetadata(camera);
    return firstPresent(
      command.cameraExternalId,
      command.camera_external_id,
      command.providerCameraId,
      command.provider_camera_id,
      command.channel,
      video.external_camera_id,
      video.externalCameraId,
      video.provider_camera_id,
      video.providerCameraId,
      video.channel,
      video.stream_id,
      video.streamId,
      camera.external_camera_id,
      camera.externalCameraId,
      camera.external_device_id,
      camera.externalDeviceId,
      camera.id,
    );
  }

  getWindow(command = {}) {
    const occurredAt = parseDate(
      command.occurredAt || command.occurred_at || command.timestamp,
      new Date(),
    );
    const beforeSeconds = Number(firstPresent(
      command.windowBeforeSeconds,
      command.window_before_seconds,
      this.config.window_before_seconds,
      this.config.windowBeforeSeconds,
      DEFAULT_WINDOW_BEFORE_SECONDS,
    ));
    const afterSeconds = Number(firstPresent(
      command.windowAfterSeconds,
      command.window_after_seconds,
      this.config.window_after_seconds,
      this.config.windowAfterSeconds,
      DEFAULT_WINDOW_AFTER_SECONDS,
    ));

    return {
      occurredAt,
      start: addSeconds(occurredAt, -Math.max(0, beforeSeconds || 0)),
      end: addSeconds(occurredAt, Math.max(0, afterSeconds || 0)),
    };
  }

  buildUrl(pathOrUrl, query = {}) {
    if (!pathOrUrl) return null;
    const raw = String(pathOrUrl).trim();
    if (!raw) return null;

    if (raw.startsWith('/') && !raw.startsWith('//') && !this.baseUrl) {
      return sanitizeUrlReference(appendQueryToLocalPath(raw, query));
    }

    try {
      const parsed = raw.startsWith('http://') || raw.startsWith('https://')
        ? new URL(raw)
        : new URL(raw.startsWith('/') ? `${this.baseUrl}${raw}` : `${this.baseUrl}/${raw}`);
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') parsed.searchParams.set(key, String(value));
      }
      return sanitizeUrlReference(parsed.toString());
    } catch {
      return null;
    }
  }

  buildTemplateValues(command = {}) {
    const camera = command.camera || {};
    const video = this.getCameraVideoMetadata(camera);
    const cameraId = this.getCameraId(camera, command);
    const { occurredAt, start, end } = this.getWindow(command);
    const durationSeconds = Math.max(1, Math.round((end.getTime() - start.getTime()) / 1000));

    return {
      baseUrl: this.baseUrl,
      provider: this.provider,
      providerConfigId: this.providerConfigId,
      cameraId,
      cameraExternalId: cameraId,
      channel: firstPresent(command.channel, video.channel, cameraId),
      stream: firstPresent(command.stream, video.stream, 'main'),
      imageUri: firstPresent(command.imageUri, command.image_uri, video.image_uri, video.imageUri),
      videoUri: firstPresent(command.videoUri, command.video_uri, video.video_uri, video.videoUri),
      streamingUri: firstPresent(command.streamingUri, command.streaming_uri, video.streaming_uri, video.streamingUri),
      accessPointId: camera.access_point_id || command.accessPointId || command.access_point_id || '',
      incidentId: command.incident?.id || command.accessIncidentId || command.access_incident_id || '',
      visitLogId: command.visitLog?.id || command.visit_log_id || command.visitLogId || '',
      timestampIso: isoNoMillis(occurredAt),
      timestampIsoLocal: isoLocalNoZone(occurredAt),
      timestampMs: occurredAt.getTime(),
      timestampSec: Math.floor(occurredAt.getTime() / 1000),
      timestampCompact: compactUtc(occurredAt),
      timestampTrassir: compactUtc(occurredAt),
      startIso: isoNoMillis(start),
      startIsoLocal: isoLocalNoZone(start),
      startMs: start.getTime(),
      startSec: Math.floor(start.getTime() / 1000),
      startCompact: compactUtc(start),
      startAxxon: axxonUtc(start),
      endIso: isoNoMillis(end),
      endIsoLocal: isoLocalNoZone(end),
      endMs: end.getTime(),
      endSec: Math.floor(end.getTime() / 1000),
      endCompact: compactUtc(end),
      endAxxon: axxonUtc(end),
      durationSeconds,
      durationHms: hms(durationSeconds),
    };
  }

  getTemplates() {
    return {
      snapshotUrlTemplate: firstPresent(
        this.config.snapshotUrlTemplate,
        this.config.snapshot_url_template,
        this.config.snapshotTemplate,
        this.config.snapshot_template,
      ),
      clipUrlTemplate: firstPresent(
        this.config.clipUrlTemplate,
        this.config.clip_url_template,
        this.config.archiveUrlTemplate,
        this.config.archive_url_template,
      ),
      externalRefTemplate: firstPresent(
        this.config.externalRefTemplate,
        this.config.external_ref_template,
        this.config.providerRefTemplate,
        this.config.provider_ref_template,
      ),
      videoProviderEventIdTemplate: firstPresent(
        this.config.videoProviderEventIdTemplate,
        this.config.video_provider_event_id_template,
        this.config.eventIdTemplate,
        this.config.event_id_template,
      ),
    };
  }

  buildLinks(command = {}, defaults = {}) {
    const values = this.buildTemplateValues(command);
    const templates = this.getTemplates();

    const snapshotTemplate = templates.snapshotUrlTemplate || defaults.snapshotUrlTemplate || null;
    const clipTemplate = templates.clipUrlTemplate || defaults.clipUrlTemplate || null;
    const externalTemplate = templates.externalRefTemplate || defaults.externalRefTemplate || null;
    const eventIdTemplate = templates.videoProviderEventIdTemplate || defaults.videoProviderEventIdTemplate || null;

    const snapshotCandidate = renderTemplate(snapshotTemplate, values);
    const clipCandidate = renderTemplate(clipTemplate, values);
    const externalRef = renderTemplate(externalTemplate, values);
    const videoProviderEventId = renderTemplate(eventIdTemplate, values);

    return {
      values,
      snapshotUrl: snapshotCandidate ? this.buildUrl(snapshotCandidate) : null,
      clipUrl: clipCandidate ? this.buildUrl(clipCandidate) : null,
      externalRef: externalRef || null,
      videoProviderEventId: videoProviderEventId || null,
    };
  }

  inferEvidenceType({ clipUrl, snapshotUrl, externalRef, videoProviderEventId }) {
    if (clipUrl) return 'clip';
    if (snapshotUrl) return 'snapshot';
    if (externalRef || videoProviderEventId) return 'event_reference';
    return 'unavailable';
  }

  buildEvidenceReference(command = {}) {
    const built = this.buildLinks(command);
    return this.toEvidenceReference(command, built);
  }

  toEvidenceReference(command = {}, built = {}) {
    const camera = command.camera || {};
    const { start, end } = this.getWindow(command);
    const hasReference = Boolean(
      built.clipUrl || built.snapshotUrl || built.externalRef || built.videoProviderEventId,
    );
    const cameraId = built.values?.cameraId || this.getCameraId(camera, command);

    return {
      access_incident_id: command.incident?.id || command.accessIncidentId || command.access_incident_id || null,
      visit_log_id: command.visitLog?.id || command.visit_log_id || command.visitLogId || null,
      skud_integration_event_id: command.skudIntegrationEvent?.id || command.skud_integration_event_id || null,
      camera_device_id: camera.id || command.cameraDeviceId || command.camera_device_id || null,
      provider_config_id: camera.provider_config_id || null,
      video_provider_config_id: this.providerConfigId,
      evidence_type: this.inferEvidenceType({
        clipUrl: built.clipUrl,
        snapshotUrl: built.snapshotUrl,
        externalRef: built.externalRef,
        videoProviderEventId: built.videoProviderEventId,
      }),
      source: 'provider',
      status: hasReference ? 'linked' : 'unavailable',
      title: command.title || `${this.displayName || this.provider} evidence`,
      clip_url: built.clipUrl || null,
      snapshot_url: built.snapshotUrl || null,
      external_ref: built.externalRef || null,
      video_provider_event_id: built.videoProviderEventId || null,
      video_timestamp_from: start.toISOString(),
      video_timestamp_to: end.toISOString(),
      sensitivity: command.sensitivity || 'restricted',
      metadata: {
        provider: this.provider,
        provider_display_name: this.displayName || null,
        video_provider_config_id: this.providerConfigId,
        camera_external_id: cameraId || null,
        access_point_id: camera.access_point_id || null,
        auth_ref: this.authRef || null,
        generated_by: 'video_provider_adapter',
        capabilities: this.getCapabilities(),
        no_biometrics: true,
      },
    };
  }
}

class TrassirAdapter extends VideoProviderAdapter {
  constructor(config = {}) {
    super({ ...config, provider: 'trassir' });
  }

  defaultCapabilities() {
    return ['snapshot', 'archive_export', 'event_reference'];
  }

  buildEvidenceReference(command = {}) {
    const built = this.buildLinks(command, {
      snapshotUrlTemplate: '/screenshot/{cameraId}?timestamp={timestampTrassir}',
      externalRefTemplate: 'trassir:archive:{cameraId}:{startCompact}:{endCompact}',
    });
    return this.toEvidenceReference(command, built);
  }
}

class MacroscopAdapter extends VideoProviderAdapter {
  constructor(config = {}) {
    super({ ...config, provider: 'macroscop' });
  }

  defaultCapabilities() {
    return ['archive_export', 'camera_status', 'event_reference'];
  }

  buildEvidenceReference(command = {}) {
    const built = this.buildLinks(command, {
      externalRefTemplate: 'macroscop:archive_export:{cameraId}:{startIso}:{endIso}',
    });
    return this.toEvidenceReference(command, built);
  }
}

class HikvisionNvrAdapter extends VideoProviderAdapter {
  constructor(config = {}) {
    super({ ...config, provider: 'hikvision_nvr' });
  }

  defaultCapabilities() {
    return ['snapshot', 'recording_reference', 'event_reference'];
  }

  buildEvidenceReference(command = {}) {
    const built = this.buildLinks(command, {
      snapshotUrlTemplate: '/ISAPI/Streaming/channels/{cameraId}/picture',
      externalRefTemplate: 'hikvision_nvr:recording:{cameraId}:{startIso}:{endIso}',
    });
    return this.toEvidenceReference(command, built);
  }
}

class DahuaNvrAdapter extends VideoProviderAdapter {
  constructor(config = {}) {
    super({ ...config, provider: 'dahua_nvr' });
  }

  defaultCapabilities() {
    return ['snapshot', 'recording_reference', 'event_reference'];
  }

  buildEvidenceReference(command = {}) {
    const built = this.buildLinks(command, {
      snapshotUrlTemplate: '/cgi-bin/snapshot.cgi?channel={cameraId}',
      externalRefTemplate: 'dahua_nvr:recording:{cameraId}:{startIso}:{endIso}',
    });
    return this.toEvidenceReference(command, built);
  }
}

class AxxonNextAdapter extends VideoProviderAdapter {
  constructor(config = {}) {
    super({ ...config, provider: 'axxon_next' });
  }

  defaultCapabilities() {
    return ['snapshot_export', 'archive_export', 'event_reference'];
  }

  buildEvidenceReference(command = {}) {
    const built = this.buildLinks(command, {
      externalRefTemplate: 'axxon_next:export/archive/{cameraId}/{startAxxon}/{endAxxon}',
    });
    return this.toEvidenceReference(command, built);
  }
}

class DevLineLineAdapter extends VideoProviderAdapter {
  constructor(config = {}) {
    super({ ...config, provider: 'devline_line' });
  }

  defaultCapabilities() {
    return ['snapshot', 'mp4_archive', 'event_reference'];
  }

  buildEvidenceReference(command = {}) {
    const values = this.buildTemplateValues(command);
    const video = this.getCameraVideoMetadata(command.camera || {});
    const imageUri = values.imageUri;
    const streamingUri = values.streamingUri;

    const built = this.buildLinks(command, {
      snapshotUrlTemplate: imageUri || null,
      clipUrlTemplate: firstPresent(
        streamingUri ? `${streamingUri}/main.mp4?time={startIsoLocal}&duration={durationHms}&download=1&audio=0` : null,
        video.camera_index !== undefined ? '/cameras/{cameraId}/streaming/main.mp4?time={startIsoLocal}&duration={durationHms}&download=1&audio=0' : null,
        '/cameras/{cameraId}/streaming/main.mp4?time={startIsoLocal}&duration={durationHms}&download=1&audio=0',
      ),
      externalRefTemplate: 'devline_line:archive:{cameraId}:{startIsoLocal}:{durationHms}',
    });
    return this.toEvidenceReference(command, built);
  }
}

class GenericLinkAdapter extends VideoProviderAdapter {
  constructor(config = {}) {
    super({ ...config, provider: 'generic_link' });
  }

  defaultCapabilities() {
    return ['template_link', 'event_reference'];
  }
}

module.exports = {
  AxxonNextAdapter,
  DahuaNvrAdapter,
  DevLineLineAdapter,
  GenericLinkAdapter,
  HikvisionNvrAdapter,
  MacroscopAdapter,
  TrassirAdapter,
  VideoProviderAdapter,
  parseJsonObject,
  sanitizeUrlReference,
};
