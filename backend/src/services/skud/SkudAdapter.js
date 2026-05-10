'use strict';

class SkudAdapter {
  constructor({ provider = 'generic', capabilities = [], config = {} } = {}) {
    this.provider = provider;
    this.capabilities = new Set(capabilities);
    this.config = config;
  }

  getCapabilities() {
    return Array.from(this.capabilities);
  }

  supports(capability) {
    return this.capabilities.has(capability);
  }

  async provisionAccess(command) {
    return this.addAccess(command.passId || command.pass_id, {
      name: command.name || command.personName || command.person_name,
      validUntil: command.validUntil || command.valid_until,
      raw: command,
    });
  }

  async revokeAccess(command) {
    return this.removeAccess(command.passId || command.pass_id);
  }

  async getHealth() {
    return { provider: this.provider, status: 'unknown' };
  }

  normalizeInboundEvent(rawEvent) {
    return {
      provider: this.provider,
      eventType: rawEvent?.eventType || rawEvent?.event_type || 'unknown',
      externalEventId: rawEvent?.id || rawEvent?.event_id || rawEvent?.external_event_id || null,
      payload: rawEvent || {},
    };
  }

  /**
   * addAccess — provision a person in the access-control system.
   * @param {string} passId      — unique identifier for the pass/visitor (typically request id)
   * @param {object} personData  — { name: string, validUntil?: Date }
   */
  async addAccess(passId, personData) {
    throw new Error(`${this.constructor.name}.addAccess not implemented`);
  }

  /**
   * removeAccess — revoke a person's access.
   * @param {string} passId
   */
  async removeAccess(passId) {
    throw new Error(`${this.constructor.name}.removeAccess not implemented`);
  }

  /**
   * getStatus — query the current access status of a pass.
   * @param {string} passId
   * @returns {Promise<{ passId: string, status: string }>}
   */
  async getStatus(passId) {
    throw new Error(`${this.constructor.name}.getStatus not implemented`);
  }
}

module.exports = { SkudAdapter };
