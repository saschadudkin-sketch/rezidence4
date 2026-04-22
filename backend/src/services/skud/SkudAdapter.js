'use strict';

/**
 * SkudAdapter — abstract base class for access-control system integrations.
 *
 * Concrete implementations (HikvisionAdapter, BolidAdapter) extend this class
 * and override all three methods.  The factory in index.js returns the correct
 * concrete instance based on property feature_flags or the SKUD_ADAPTER env var.
 */
class SkudAdapter {
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
