'use strict';

// FIX [BUG-4]: добавляем mock для pool.connect() — нужен для транзакций в requests.js
// withTransaction вызывает pool.connect() → client.query('BEGIN') → ... → client.query('COMMIT')
const mockClient = {
  query:   jest.fn(),
  release: jest.fn(),
};

const db = {
  query:   jest.fn(),
  migrate: jest.fn().mockResolvedValue(undefined),
  pool: {
    connect: jest.fn().mockResolvedValue(mockClient),
  },
  // Экспортируем mockClient для настройки в тестах
  _mockClient: mockClient,
};

module.exports = db;
