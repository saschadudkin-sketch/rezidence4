'use strict';

const { SkudAdapter } = require('./SkudAdapter');

const DEFAULT_TIMEOUT_MS = 8000;

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''),
  );
}

function parseJsonObject(value) {
  if (!value) return {};
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function toIsoString(value) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function renderTemplate(template, values) {
  if (!template) return null;
  return String(template).replace(/\{([A-Za-z0-9_.-]+)\}/g, (_match, key) => {
    const value = values[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function normalizeMethod(value, fallback = 'POST') {
  const method = String(value || fallback).trim().toUpperCase();
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? method : fallback;
}

function resolveVisitId(passId, raw = {}) {
  return firstPresent(
    raw.providerVisitId,
    raw.provider_visit_id,
    raw.externalVisitId,
    raw.external_visit_id,
    raw.external_id,
    raw.visitId,
    raw.visit_id,
    raw.personId,
    raw.person_id,
    passId,
  );
}

function buildTemplateValues(passId, command = {}) {
  const raw = command.raw || command;
  return compactObject({
    passId,
    personId: resolveVisitId(passId, raw),
    name: command.name || raw.name || raw.personName || raw.person_name,
    validFrom: toIsoString(command.validFrom || command.valid_from || raw.validFrom || raw.valid_from),
    validUntil: toIsoString(command.validUntil || command.valid_until || raw.validUntil || raw.valid_until),
    pointId: command.pointId || command.point_id || raw.pointId || raw.point_id,
    accessPointId: command.pointId || command.point_id || raw.accessPointId || raw.access_point_id,
    vehiclePlate: command.vehiclePlate || command.vehicle_plate || raw.vehiclePlate || raw.vehicle_plate,
    cardNumber: raw.cardNumber || raw.card_number || raw.card || raw.identifier,
    phone: raw.phone,
    email: raw.email,
  });
}

function resolveEndpoint(config, action) {
  const endpoints = parseJsonObject(config.endpoints || config.endpoint || {});
  const endpoint = endpoints[action] || config[`${action}Endpoint`] || config[`${action}_endpoint`] || null;
  if (!endpoint) return null;
  if (typeof endpoint === 'string') return { url: endpoint, method: action === 'revokeAccess' ? 'DELETE' : 'POST' };
  return endpoint;
}

function normalizeAccessResult(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (payload.success === false || payload.ok === false) {
    const message = payload.message || payload.error || payload.errorMessage || 'provider operation returned failure';
    throw new Error(String(message));
  }
  return payload.result || payload.operationResult || payload.data || payload;
}

class TemplateSkudAdapter extends SkudAdapter {
  constructor({
    provider = 'generic',
    apiUrl,
    username,
    password,
    authToken,
    token,
    capabilities = ['provision_access', 'revoke_access', 'inbound_events', 'status'],
    requestTimeoutMs = DEFAULT_TIMEOUT_MS,
    ...config
  } = {}) {
    super({
      provider,
      capabilities,
      config: {
        apiUrl,
        username,
        requestTimeoutMs,
        ...config,
      },
    });
    this.baseUrl = String(apiUrl || '').replace(/\/+$/, '');
    this.username = username || null;
    this.password = password || null;
    this.authToken = authToken || token || null;
    this.requestTimeoutMs = Number(requestTimeoutMs) > 0 ? Number(requestTimeoutMs) : DEFAULT_TIMEOUT_MS;
    this.templates = parseJsonObject(config.templates || config.bodyTemplates || config.body_templates || {});
    this.config = { ...this.config, ...config };
  }

  buildHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.authToken) headers.Authorization = `Bearer ${this.authToken}`;
    if (!this.authToken && (this.username || this.password)) {
      headers.Authorization = `Basic ${Buffer.from(`${this.username || ''}:${this.password || ''}`).toString('base64')}`;
    }
    return headers;
  }

  buildUrl(endpoint, values = {}) {
    const raw = renderTemplate(endpoint.url || endpoint.path, values);
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw)) return raw;
    if (!this.baseUrl) return raw;
    return raw.startsWith('/') ? `${this.baseUrl}${raw}` : `${this.baseUrl}/${raw}`;
  }

  buildBody(action, passId, command = {}) {
    const values = buildTemplateValues(passId, command);
    const template = this.templates[action] || null;
    if (template && typeof template === 'object') {
      const rendered = {};
      for (const [key, value] of Object.entries(template)) {
        rendered[key] = typeof value === 'string' ? renderTemplate(value, values) : value;
      }
      return compactObject(rendered);
    }
    return compactObject({
      provider: this.provider,
      passId,
      personId: values.personId,
      name: values.name,
      validFrom: values.validFrom,
      validUntil: values.validUntil,
      accessPointId: values.accessPointId,
      vehiclePlate: values.vehiclePlate,
      cardNumber: values.cardNumber,
    });
  }

  async requestConfiguredEndpoint(action, passId, command = {}) {
    const endpoint = resolveEndpoint(this.config, action);
    if (!endpoint) {
      throw new Error(`${this.constructor.name}.${action} endpoint is not configured`);
    }
    const values = buildTemplateValues(passId, command);
    const url = this.buildUrl(endpoint, values);
    const method = normalizeMethod(endpoint.method, action === 'revokeAccess' ? 'DELETE' : 'POST');
    const body = ['GET', 'DELETE'].includes(method) ? undefined : JSON.stringify(this.buildBody(action, passId, command));
    const res = await fetch(url, {
      method,
      headers: this.buildHeaders(),
      body,
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    if (!res.ok) {
      throw new Error(`${this.constructor.name}.${action} failed: HTTP ${res.status}`);
    }
    const text = await res.text();
    return normalizeAccessResult(text ? JSON.parse(text) : { ok: true });
  }

  async addAccess(passId, personData = {}) {
    return this.requestConfiguredEndpoint('provisionAccess', passId, personData);
  }

  async removeAccess(passId) {
    return this.requestConfiguredEndpoint('revokeAccess', passId, {});
  }

  async getStatus(passId) {
    const endpoint = resolveEndpoint(this.config, 'status');
    if (!endpoint) return { passId, status: 'unknown' };
    const result = await this.requestConfiguredEndpoint('status', passId, {});
    return {
      passId,
      status: result?.status || result?.state || 'unknown',
      raw: result || null,
    };
  }

  normalizeInboundEvent(rawEvent = {}) {
    const event = rawEvent.event || rawEvent.Event || rawEvent.data || rawEvent.payload || rawEvent;
    const rawType = normalizeText(firstPresent(
      event.eventType,
      event.event_type,
      event.type,
      event.action,
      event.name,
      event.description,
      rawEvent.eventType,
    ));
    const rawDirection = normalizeText(firstPresent(
      event.direction,
      event.inOut,
      event.in_out,
      event.passDirection,
      event.directionName,
      rawEvent.direction,
    ));
    const allowed = firstPresent(
      event.accessGranted,
      event.isGranted,
      event.granted,
      event.allowed,
      event.allow,
      event.success,
      rawEvent.allowed,
    );
    const denied = allowed === false
      || allowed === 'false'
      || /(deny|denied|fail|failed|forbid|reject|blocked|запрет|отказ|неуда|заблок|запрещ)/i.test(rawType);
    const direction = /(exit|out|выход|исход)/i.test(rawDirection || rawType) ? 'exit' : 'entry';

    return {
      provider: this.provider,
      eventType: `${direction}_${denied ? 'denied' : 'allowed'}`,
      externalEventId: firstPresent(
        event.id,
        event.eventId,
        event.event_id,
        event.eventNo,
        event.event_no,
        event.uuid,
        rawEvent.id,
      ) || null,
      externalDeviceId: firstPresent(
        event.deviceId,
        event.device_id,
        event.deviceID,
        event.readerId,
        event.reader_id,
        event.controllerId,
        event.controller_id,
        event.doorId,
        event.door_id,
        rawEvent.device_id,
      ) || null,
      accessPointId: firstPresent(event.accessPointId, event.access_point_id, rawEvent.access_point_id) || null,
      vehiclePlate: firstPresent(
        event.vehiclePlate,
        event.vehicle_plate,
        event.plate,
        event.plateNumber,
        event.carNumber,
        event.gosNumber,
        rawEvent.vehicle_plate,
      ) || null,
      personLabel: firstPresent(
        event.personName,
        event.person_name,
        event.fullName,
        event.full_name,
        event.name,
        event.employeeName,
        event.employee_name,
        event.card,
        event.cardNumber,
        event.card_number,
        rawEvent.person_label,
      ) || null,
      occurredAt: firstPresent(
        event.timestamp,
        event.time,
        event.dateTime,
        event.date_time,
        event.eventTime,
        event.event_time,
        rawEvent.timestamp,
        rawEvent.occurred_at,
      ) || null,
      payload: rawEvent || {},
    };
  }
}

class GenericSkudAdapter extends TemplateSkudAdapter {
  constructor(config = {}) {
    super({ ...config, provider: 'generic' });
  }
}

class SigurAdapter extends TemplateSkudAdapter {
  constructor(config = {}) {
    super({ ...config, provider: 'sigur' });
  }
}

class ParsecAdapter extends TemplateSkudAdapter {
  constructor(config = {}) {
    super({ ...config, provider: 'parsec' });
  }
}

class PercoAdapter extends TemplateSkudAdapter {
  constructor(config = {}) {
    super({ ...config, provider: 'perco' });
  }
}

class RusGuardAdapter extends TemplateSkudAdapter {
  constructor(config = {}) {
    super({ ...config, provider: 'rusguard' });
  }
}

class IronLogicAdapter extends TemplateSkudAdapter {
  constructor(config = {}) {
    super({ ...config, provider: 'ironlogic' });
  }
}

class TrassirAccessAdapter extends TemplateSkudAdapter {
  constructor(config = {}) {
    super({ ...config, provider: 'trassir_access' });
  }
}

module.exports = {
  GenericSkudAdapter,
  IronLogicAdapter,
  ParsecAdapter,
  PercoAdapter,
  RusGuardAdapter,
  SigurAdapter,
  TemplateSkudAdapter,
  TrassirAccessAdapter,
};
