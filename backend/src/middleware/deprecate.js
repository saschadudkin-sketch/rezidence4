'use strict';

const API_DEPRECATION_DATE = '2026-09-01';
const API_SUNSET = new Date(Date.UTC(2026, 8, 1, 0, 0, 0)).toUTCString();

function deprecate(_req, res, next) {
  res.setHeader('Deprecation', `version="${API_DEPRECATION_DATE}"`);
  res.setHeader('Sunset', API_SUNSET);
  next();
}

module.exports = {
  API_DEPRECATION_DATE,
  API_SUNSET,
  deprecate,
};
