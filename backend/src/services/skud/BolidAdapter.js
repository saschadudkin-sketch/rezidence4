'use strict';

const { SkudAdapter } = require('./SkudAdapter');

/**
 * BolidAdapter — stub for Bolid ORS/Orion Pro HTTP SDK integration.
 *
 * All methods throw until the Bolid SDK integration is implemented.
 * Wire up via the createSkudAdapter factory by setting
 * SKUD_ADAPTER=bolid (or property.feature_flags.skud_adapter='bolid').
 */
class BolidAdapter extends SkudAdapter {
  constructor({ apiUrl, username, password, ...config } = {}) {
    super({
      provider: 'bolid',
      capabilities: ['provision_access', 'revoke_access', 'status'],
      config: { apiUrl, username, ...config },
    });
    this.baseUrl  = apiUrl;
    this.username = username;
    this.password = password;
    // TODO: initialise Bolid HTTP SDK client here
  }

  async addAccess(passId, personData) {
    // TODO: implement via Bolid HTTP SDK
    throw new Error('BolidAdapter.addAccess not yet implemented');
  }

  async removeAccess(passId) {
    // TODO: implement via Bolid HTTP SDK
    throw new Error('BolidAdapter.removeAccess not yet implemented');
  }

  async getStatus(passId) {
    // TODO: implement via Bolid HTTP SDK
    throw new Error('BolidAdapter.getStatus not yet implemented');
  }
}

module.exports = { BolidAdapter };
