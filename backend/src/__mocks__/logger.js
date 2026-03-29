'use strict';
const logger = {
  info:  jest.fn(),
  error: jest.fn(),
  warn:  jest.fn(),
  fatal: jest.fn(),
  debug: jest.fn(),
};
module.exports = logger;
