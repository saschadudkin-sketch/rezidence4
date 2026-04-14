'use strict';

class ServiceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

class ConflictError extends ServiceError {
  constructor(message, details = {}) {
    super(message, 409);
    this.code = 'REQUEST_CONFLICT';
    this.details = details;
  }
}

module.exports = {
  ServiceError,
  ConflictError,
};
