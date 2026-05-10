'use strict';

const { SkudAdapter } = require('./SkudAdapter');

const DEFAULT_METHODS = Object.freeze({
  addVisit: 'addVisit',
  deleteVisit: 'deletevisit',
  getVisit: 'getVisitById',
  getServiceInfo: 'getServiceInfo',
  getLoginToken: 'getLoginToken',
  extendTokenExpiration: 'extendTokenExpiration',
});

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

function toIsoString(value) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function extractOperationResult(result) {
  if (!result || typeof result !== 'object') return result;
  if (!Object.prototype.hasOwnProperty.call(result, 'success')) return result;

  if (result.success === false) {
    const error = result.error || result.serviceError || {};
    const message = error.description
      || error.message
      || error.innerExceptionMessage
      || 'operation returned success=false';
    throw new Error(`Bolid JSON-RPC operation failed: ${message}`);
  }

  if (Object.prototype.hasOwnProperty.call(result, 'operationResult')) {
    return result.operationResult;
  }
  if (Object.prototype.hasOwnProperty.call(result, 'result')) {
    return result.result;
  }
  return result;
}

/**
 * BolidAdapter — Orion Pro integration module JSON-RPC adapter.
 *
 * Orion Pro deployments differ by enabled HTTP auth, remote-control token
 * policy and local visit-id strategy, so method names and token parameter names
 * are configurable through `config_json`.
 */
class BolidAdapter extends SkudAdapter {
  constructor({
    apiUrl,
    username,
    password,
    methods = {},
    authToken,
    token,
    tokenParam = 'token',
    tokenRequired = false,
    remoteLogin,
    remotePasswordMd5,
    md5Passw,
    visitDefaults,
    requestTimeoutMs = 8000,
    ...config
  } = {}) {
    super({
      provider: 'bolid',
      capabilities: ['provision_access', 'revoke_access', 'inbound_events', 'status'],
      config: {
        apiUrl,
        username,
        methods,
        tokenParam,
        tokenRequired,
        visitDefaults,
        requestTimeoutMs,
        ...config,
      },
    });
    this.baseUrl = apiUrl;
    this.username = username;
    this.password = password;
    this.methods = { ...DEFAULT_METHODS, ...methods };
    this.tokenParam = tokenParam;
    this.tokenRequired = tokenRequired === true || tokenRequired === 'true';
    this.authToken = authToken || token || null;
    this.remoteLogin = remoteLogin || config.login || null;
    this.remotePasswordMd5 = remotePasswordMd5 || md5Passw || config.remote_password_md5 || null;
    this.visitDefaults = visitDefaults || config.visit_defaults || {};
    this.requestTimeoutMs = Number(requestTimeoutMs) > 0 ? Number(requestTimeoutMs) : 8000;
    this.cachedToken = null;
  }

  buildHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.username || this.password) {
      headers.Authorization = `Basic ${Buffer.from(`${this.username || ''}:${this.password || ''}`).toString('base64')}`;
    }
    return headers;
  }

  async resolveToken() {
    if (this.authToken) return this.authToken;
    if (this.cachedToken) return this.cachedToken;
    if (!this.tokenRequired && !this.remoteLogin) return null;
    if (!this.remoteLogin || !this.remotePasswordMd5) {
      throw new Error('Bolid remote-control token requires remoteLogin and remotePasswordMd5');
    }

    const token = await this.jsonRpc(this.methods.getLoginToken, {
      login: this.remoteLogin,
      md5Passw: this.remotePasswordMd5,
    }, { includeToken: false });
    this.cachedToken = token;
    return token;
  }

  async jsonRpc(method, params = {}, { includeToken = true } = {}) {
    if (!this.baseUrl) throw new Error('Bolid apiUrl is required');

    const tokenValue = includeToken ? await this.resolveToken() : null;
    const requestParams = tokenValue
      ? { [this.tokenParam]: tokenValue, ...params }
      : params;
    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        jsonrpc: '2.0',
        method,
        params: requestParams,
        id: Date.now(),
      }),
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });

    if (!res.ok) {
      throw new Error(`Bolid JSON-RPC ${method} failed: HTTP ${res.status}`);
    }

    const text = await res.text();
    const payload = text ? JSON.parse(text) : {};
    if (payload.error) {
      const message = payload.error.message || payload.error.description || JSON.stringify(payload.error);
      throw new Error(`Bolid JSON-RPC ${method} failed: ${message}`);
    }
    return extractOperationResult(payload.result);
  }

  resolveVisitId(passId, raw = {}) {
    return firstPresent(
      raw.bolidVisitId,
      raw.providerVisitId,
      raw.externalVisitId,
      raw.external_id,
      raw.visitId,
      raw.visit_id,
      passId,
    );
  }

  buildVisit(passId, { name, validUntil, raw = {} } = {}) {
    const visitId = firstPresent(
      this.resolveVisitId(passId, raw),
      this.visitDefaults.id,
    );
    const validFrom = toIsoString(raw.validFrom || raw.valid_from) || new Date().toISOString();
    return compactObject({
      ...this.visitDefaults,
      id: visitId,
      personId: firstPresent(raw.personId, raw.person_id, this.visitDefaults.personId),
      visitedPersonId: firstPresent(raw.visitedPersonId, raw.visited_person_id, this.visitDefaults.visitedPersonId),
      visitedCompanyId: firstPresent(raw.visitedCompanyId, raw.visited_company_id, this.visitDefaults.visitedCompanyId),
      visitedDepartmentId: firstPresent(raw.visitedDepartmentId, raw.visited_department_id, this.visitDefaults.visitedDepartmentId),
      visitDate: validFrom,
      visitEndDateTime: toIsoString(validUntil || raw.validUntil || raw.valid_until),
      visitedRoom: firstPresent(raw.visitedRoom, raw.visited_room, raw.pointId, raw.point_id),
      visitPurpose: firstPresent(raw.visitPurpose, raw.visit_purpose, `DomHub access pass ${passId}`),
      impersonalPersonId: firstPresent(raw.impersonalPersonId, raw.impersonal_person_id, this.visitDefaults.impersonalPersonId),
      accessControlRule: firstPresent(raw.accessControlRule, raw.access_control_rule, this.visitDefaults.accessControlRule),
      carName: firstPresent(raw.carName, raw.car_name, this.visitDefaults.carName),
      carNumber: firstPresent(raw.carNumber, raw.car_number, raw.vehiclePlate, raw.vehicle_plate),
      carColor: firstPresent(raw.carColor, raw.car_color, this.visitDefaults.carColor),
      isCarOvernight: firstPresent(raw.isCarOvernight, raw.is_car_overnight, this.visitDefaults.isCarOvernight),
      visitorName: name || raw.personName || raw.person_name || raw.visitorName || raw.visitor_name,
    });
  }

  async addAccess(passId, personData = {}) {
    return this.jsonRpc(this.methods.addVisit, {
      visit: this.buildVisit(passId, personData),
    });
  }

  async removeAccess(passId) {
    return this.jsonRpc(this.methods.deleteVisit, {
      visit: { id: this.resolveVisitId(passId) },
    });
  }

  async getStatus(passId) {
    const result = await this.jsonRpc(this.methods.getVisit, {
      id: passId,
      visitId: passId,
      externalId: passId,
    });
    return {
      passId,
      status: result?.status || result?.state || 'unknown',
      raw: result || null,
    };
  }

  async getHealth() {
    const result = await this.jsonRpc(this.methods.getServiceInfo, {});
    return {
      provider: this.provider,
      status: 'healthy',
      raw: result || null,
    };
  }

  normalizeInboundEvent(rawEvent = {}) {
    const event = rawEvent.event || rawEvent.Event || rawEvent.operationResult || rawEvent;
    const rawType = normalizeText(firstPresent(
      event.eventType,
      event.event_type,
      event.type,
      event.charId,
      event.char_id,
      event.description,
      rawEvent.eventType,
    ));
    const rawDirection = normalizeText(firstPresent(
      event.direction,
      event.inOut,
      event.in_out,
      event.passDirection,
      event.entryType,
      rawEvent.direction,
    ));
    const allowed = firstPresent(event.accessGranted, event.isGranted, event.allowed, event.allow, rawEvent.allowed);
    const denied = allowed === false
      || allowed === 'false'
      || /(deny|denied|fail|failed|forbid|reject|blocked|запрет|отказ|неуда|заблок)/i.test(rawType);
    const direction = /(exit|out|выход)/i.test(rawDirection || rawType) ? 'exit' : 'entry';

    return {
      provider: this.provider,
      eventType: `${direction}_${denied ? 'denied' : 'allowed'}`,
      externalEventId: firstPresent(
        event.id,
        event.eventId,
        event.event_id,
        event.eventNo,
        event.event_no,
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
        event.name,
        event.passNumber,
        event.pass_number,
        event.card,
        event.key,
        rawEvent.person_label,
      ) || null,
      occurredAt: firstPresent(
        event.timestamp,
        event.time,
        event.dateTime,
        event.date_time,
        event.eventTime,
        rawEvent.timestamp,
        rawEvent.occurred_at,
      ) || null,
      payload: rawEvent || {},
    };
  }
}

module.exports = { BolidAdapter };
