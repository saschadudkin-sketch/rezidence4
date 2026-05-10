'use strict';

const {
  AxxonNextAdapter,
  DahuaNvrAdapter,
  DevLineLineAdapter,
  GenericLinkAdapter,
  HikvisionNvrAdapter,
  MacroscopAdapter,
  TrassirAdapter,
  VideoProviderAdapter,
  parseJsonObject,
} = require('./VideoProviderAdapter');

const ADAPTER_REGISTRY = new Map([
  ['trassir', TrassirAdapter],
  ['macroscop', MacroscopAdapter],
  ['hikvision_nvr', HikvisionNvrAdapter],
  ['dahua_nvr', DahuaNvrAdapter],
  ['axxon_next', AxxonNextAdapter],
  ['devline_line', DevLineLineAdapter],
  ['generic_link', GenericLinkAdapter],
]);

function normalizeAdapterType(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim().toLowerCase();
}

function getRegisteredVideoProviders() {
  return Array.from(ADAPTER_REGISTRY.keys()).sort();
}

function registerVideoAdapter(type, AdapterClass) {
  const normalized = normalizeAdapterType(type);
  if (!normalized) throw new Error('Video adapter type is required');
  if (typeof AdapterClass !== 'function') throw new Error('Video AdapterClass must be a constructor');
  ADAPTER_REGISTRY.set(normalized, AdapterClass);
}

function resolveAdapterConfig(configOrProperty = {}) {
  const configJson = parseJsonObject(configOrProperty.config_json || configOrProperty.configJson || configOrProperty.config);
  return {
    ...configJson,
    provider: configOrProperty.provider || configJson.provider || 'generic_link',
    providerConfigId:
      configOrProperty.video_provider_config_id
      || configOrProperty.providerConfigId
      || configOrProperty.provider_config_id
      || configOrProperty.id
      || null,
    propertyId: configOrProperty.property_id || configOrProperty.propertyId || null,
    displayName: configOrProperty.display_name || configOrProperty.displayName || null,
    baseUrl:
      configOrProperty.base_url
      || configOrProperty.baseUrl
      || configJson.base_url
      || configJson.baseUrl
      || '',
    authRef:
      configOrProperty.auth_ref
      || configOrProperty.authRef
      || configJson.auth_ref
      || configJson.authRef
      || null,
    capabilities: configOrProperty.capabilities || configJson.capabilities || [],
    config: configJson,
  };
}

function createVideoAdapter(configOrProperty = null) {
  const adapterType = normalizeAdapterType(
    configOrProperty?.provider
    || configOrProperty?.type
    || configOrProperty?.feature_flags?.video_provider
    || process.env.VIDEO_PROVIDER,
  );

  if (!adapterType) return null;
  const AdapterClass = ADAPTER_REGISTRY.get(adapterType);
  if (!AdapterClass) return null;

  return new AdapterClass(resolveAdapterConfig(configOrProperty || {}));
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
  createVideoAdapter,
  getRegisteredVideoProviders,
  registerVideoAdapter,
};
