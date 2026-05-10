'use strict';

const { HikvisionAdapter } = require('./HikvisionAdapter');
const { BolidAdapter }     = require('./BolidAdapter');
const {
  GenericSkudAdapter,
  IronLogicAdapter,
  ParsecAdapter,
  PercoAdapter,
  RusGuardAdapter,
  SigurAdapter,
  TrassirAccessAdapter,
} = require('./TemplateSkudAdapter');

const ADAPTER_REGISTRY = new Map([
  ['hikvision', HikvisionAdapter],
  ['bolid', BolidAdapter],
  ['sigur', SigurAdapter],
  ['parsec', ParsecAdapter],
  ['perco', PercoAdapter],
  ['rusguard', RusGuardAdapter],
  ['ironlogic', IronLogicAdapter],
  ['trassir_access', TrassirAccessAdapter],
  ['generic', GenericSkudAdapter],
]);

function normalizeAdapterType(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim().toLowerCase();
}

function getRegisteredSkudProviders() {
  return Array.from(ADAPTER_REGISTRY.keys()).sort();
}

function registerSkudAdapter(type, AdapterClass) {
  const normalized = normalizeAdapterType(type);
  if (!normalized) throw new Error('SKUD adapter type is required');
  if (typeof AdapterClass !== 'function') throw new Error('SKUD AdapterClass must be a constructor');
  ADAPTER_REGISTRY.set(normalized, AdapterClass);
}

function resolveAdapterType(configOrProperty) {
  return normalizeAdapterType(
    configOrProperty?.provider
    || configOrProperty?.type
    || configOrProperty?.feature_flags?.skud_adapter
    || process.env.SKUD_ADAPTER,
  );
}

function resolveAdapterConfig(configOrProperty = {}) {
  const configJson = configOrProperty.config_json || configOrProperty.config || {};
  return {
    ...configJson,
    apiUrl: (
      configOrProperty.base_url
      || configOrProperty.apiUrl
      || configJson.apiUrl
      || process.env.SKUD_API_URL
      || ''
    ),
    username: (
      configOrProperty.username
      || configJson.username
      || process.env.SKUD_API_USER
      || ''
    ),
    password: (
      configOrProperty.password
      || configJson.password
      || process.env.SKUD_API_PASSWORD
      || ''
    ),
    authRef: configOrProperty.auth_ref || configOrProperty.authRef || configJson.authRef || null,
    providerConfigId: configOrProperty.id || configOrProperty.provider_config_id || null,
    propertyId: configOrProperty.property_id || configOrProperty.propertyId || null,
  };
}

function createSkudAdapter(configOrProperty = null) {
  const adapterType = resolveAdapterType(configOrProperty || {});

  if (!adapterType) return null;
  const AdapterClass = ADAPTER_REGISTRY.get(adapterType);
  if (!AdapterClass) return null;

  return new AdapterClass(resolveAdapterConfig(configOrProperty || {}));
}

module.exports = {
  createSkudAdapter,
  getRegisteredSkudProviders,
  registerSkudAdapter,
};
