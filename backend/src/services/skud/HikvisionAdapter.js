'use strict';

const { SkudAdapter } = require('./SkudAdapter');

/**
 * HikvisionAdapter — Hikvision ISAPI access-control integration.
 *
 * Implements the three SkudAdapter methods against the Hikvision ISAPI
 * REST interface.  The device must be reachable at `apiUrl` with digest or
 * basic auth (username / password).
 */
class HikvisionAdapter extends SkudAdapter {
  constructor({ apiUrl, username, password }) {
    super();
    this.baseUrl = apiUrl;
    this.auth    = Buffer.from(`${username}:${password}`).toString('base64');
  }

  /**
   * addAccess — create a visitor user profile with a validity window.
   * Calls POST /ISAPI/AccessControl/UserInfo/SetUp
   */
  async addAccess(passId, { name, validUntil }) {
    const res = await fetch(`${this.baseUrl}/ISAPI/AccessControl/UserInfo/SetUp`, {
      method:  'POST',
      headers: {
        Authorization:   `Basic ${this.auth}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        UserInfo: {
          employeeNo: passId,
          name,
          userType: 'visitor',
          Valid: {
            enable:    true,
            beginTime: new Date().toISOString(),
            endTime:   validUntil instanceof Date
              ? validUntil.toISOString()
              : new Date(Date.now() + 86400000).toISOString(),
          },
        },
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      throw new Error(`Hikvision addAccess failed: HTTP ${res.status}`);
    }
  }

  /**
   * removeAccess — delete a visitor user profile by employeeNo.
   * Calls PUT /ISAPI/AccessControl/UserInfo/Delete
   */
  async removeAccess(passId) {
    const res = await fetch(`${this.baseUrl}/ISAPI/AccessControl/UserInfo/Delete`, {
      method:  'PUT',
      headers: {
        Authorization:   `Basic ${this.auth}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        UserInfoDelCond: {
          EmployeeNoList: [{ employeeNo: passId }],
        },
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      throw new Error(`Hikvision removeAccess failed: HTTP ${res.status}`);
    }
  }

  /**
   * getStatus — Hikvision ISAPI does not expose a simple per-pass status
   * endpoint; return a static placeholder so callers do not throw.
   */
  async getStatus(passId) {
    return { passId, status: 'unknown' };
  }
}

module.exports = { HikvisionAdapter };
