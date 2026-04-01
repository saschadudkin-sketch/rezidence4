'use strict';

const SUNSET_ISO_DATE = '2026-09-01';
const SUNSET_UTC = new Date(`${SUNSET_ISO_DATE}T00:00:00.000Z`);
const SUNSET_HTTP_DATE = SUNSET_UTC.toUTCString();
const DEPRECATION_HEADER_VALUE = `version="${SUNSET_ISO_DATE}"`;

function deprecate(_req, res, next) {
  res.setHeader('Deprecation', DEPRECATION_HEADER_VALUE);
  res.setHeader('Sunset', SUNSET_HTTP_DATE);
  next();
}

module.exports = {
  SUNSET_ISO_DATE,
  SUNSET_HTTP_DATE,
  DEPRECATION_HEADER_VALUE,
  deprecate,
};
