# DomHub v2.0 Multi-Tenant Migration Guide

This document outlines the changes made for DomHub v2.0 Phase 0 and how to integrate multi-tenant support.

## Overview

DomHub v2.0 introduces multi-tenant architecture where:
- **Platform DB** stores the registry of all residential complexes (properties)
- **Property DBs** store the actual application data for each property separately
- **Property-aware middleware** routes requests to the correct database

## New Files Created

### 1. Platform Database Migration System
- `backend/src/platformMigrations.js` - Platform database schema migrations
- `backend/src/middleware/propertyDb.js` - Property-aware database middleware

### 2. Enhanced Database Connection
- Updated `backend/src/db.js` with `getPlatformDb()` and `migratePlatform()` functions
- Updated `backend/src/migrate.js` to run both platform and property migrations

### 3. Configuration Updates
- Updated `backend/src/config/appConfig.js` with new validation
- Updated `.env.example` with new environment variables

### 4. New Tests
- `backend/src/__tests__/platformDb.test.js`
- `backend/src/__tests__/platformMigrations.test.js`

## Environment Variables

Add to your `.env` file:

```env
# Platform Database (Multi-tenant Registry)
PLATFORM_DB_URL=postgresql://user:pass@localhost:5432/domhub_platform
PLATFORM_JWT_SECRET=different_32_char_secret_from_main_jwt

# Property Database URLs (one per property)
ZAMOSKV_DB_URL=postgresql://user:pass@localhost:5432/domhub_zamoskv
```

## Database Setup

### 1. Create Platform Database

```sql
-- Create platform database
CREATE DATABASE domhub_platform;

-- Run platform migrations
node src/migrate.js
```

### 2. Property Databases

Each property needs its own database:

```sql
-- Example: Zamoskvorech'ya property
CREATE DATABASE domhub_zamoskv;

-- Property databases use the existing migrations plus the new multi-tenant migration
-- Migration will be run automatically by migrate.js
```

## Integrating Property-Aware Middleware

### Current Pattern (Single-Tenant)
```javascript
// routes/users.js
const db = require('../db');

router.get('/', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM users');
  res.json(rows);
});
```

### New Pattern (Multi-Tenant)
```javascript
// routes/users.js
const { propertyDbMiddleware } = require('../middleware/propertyDb');

// Apply property middleware to routes that need it
router.use(propertyDbMiddleware);

router.get('/', async (req, res) => {
  // Use req.db instead of db for property-specific queries
  const { rows } = await req.db.query('SELECT * FROM users WHERE property_slug = $1', [req.propertySlug]);
  res.json(rows);
});
```

### Client-Side Integration

Clients must include property context in requests:

**Option 1: Header-based (recommended for API clients)**
```javascript
fetch('/api/v1/users', {
  headers: {
    'X-Property-Slug': 'zamoskv',
    'Authorization': 'Bearer ' + token
  }
});
```

**Option 2: JWT-based (recommended for web apps)**
```javascript
// JWT payload should include property_slug claim
{
  "uid": "user-123",
  "role": "owner", 
  "property_slug": "zamoskv",
  "exp": 1640995200
}
```

## Migration Steps for Existing Routes

1. **Identify routes that need multi-tenant support**
   - User management
   - Requests/tickets  
   - Chat messages
   - Announcements (new)
   - Documents (new)

2. **Add property middleware**
   ```javascript
   const { propertyDbMiddleware } = require('../middleware/propertyDb');
   router.use(propertyDbMiddleware);
   ```

3. **Replace `db.query` with `req.db.query`**
   ```javascript
   // Before
   await db.query('SELECT * FROM users');
   
   // After  
   await req.db.query('SELECT * FROM users');
   ```

4. **Update queries to include property context where needed**
   ```javascript
   await req.db.query(
     'UPDATE users SET property_slug = $1 WHERE uid = $2',
     [req.propertySlug, uid]
   );
   ```

## Platform Administration Routes

Future platform administration routes will use the platform database:

```javascript
// routes/platform/properties.js
const { getPlatformDb } = require('../db');

router.get('/properties', async (req, res) => {
  const platformDb = getPlatformDb();
  const { rows } = await platformDb.query('SELECT * FROM properties WHERE is_active = true');
  res.json(rows);
});
```

## Error Handling

The property middleware handles several error cases:

- **400**: No property slug provided
- **404**: Property not found
- **503**: Property disabled (`is_active = false`)
- **500**: Database connection or other errors

## Performance Considerations

- **Connection Pooling**: Each property gets its own connection pool
- **Caching**: Property metadata cached for 60 seconds
- **Graceful Shutdown**: `closeAllPools()` function available for cleanup

## Testing

Run tests to ensure functionality:

```bash
npm test
```

The new test files cover:
- Property extraction from headers/JWT
- Database connection pooling
- Caching behavior
- Error conditions
- Migration schema validation

## Next Steps

1. **Phase 1**: Implement push notifications using the new `push_subscriptions` table
2. **Phase 2**: Add announcements and documents features
3. **Platform Admin UI**: Create admin interface for managing properties
4. **Multi-database Queries**: Add support for cross-property analytics (if needed)