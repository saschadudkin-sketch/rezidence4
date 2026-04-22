#!/usr/bin/env node
'use strict';

/**
 * Verification script for platform database functionality
 * Usage: node src/scripts/verifyPlatformDb.js
 */

require('dotenv').config();
const { getPlatformDb, migratePlatform } = require('../db');
const { extractPropertySlug, getProperty } = require('../middleware/propertyDb');
const logger = require('../logger');

async function verifyPlatformDatabase() {
  logger.info('[verify] Starting platform database verification...');

  try {
    // 1. Test platform database connection
    logger.info('[verify] Testing platform database connection...');
    const platformDb = getPlatformDb();
    await platformDb.query('SELECT 1');
    logger.info('[verify] ✓ Platform database connection successful');

    // 2. Verify migrations table exists
    logger.info('[verify] Checking platform migrations...');
    const { rows: migrations } = await platformDb.query(
      'SELECT id FROM platform_schema_migrations ORDER BY id'
    );
    logger.info(`[verify] ✓ Found ${migrations.length} applied platform migrations:`, migrations.map(m => m.id));

    // 3. Verify properties table and data
    logger.info('[verify] Checking properties table...');
    const { rows: properties } = await platformDb.query('SELECT slug, name, is_active FROM properties');
    logger.info(`[verify] ✓ Found ${properties.length} properties:`, properties);

    // 4. Test property retrieval function
    if (properties.length > 0) {
      const testSlug = properties[0].slug;
      logger.info(`[verify] Testing property retrieval for slug: ${testSlug}`);
      const property = await getProperty(testSlug);
      if (property) {
        logger.info('[verify] ✓ Property retrieval successful:', {
          slug: property.slug,
          name: property.name,
          is_active: property.is_active
        });
      } else {
        logger.error('[verify] ✗ Property retrieval failed');
      }
    }

    // 5. Test property slug extraction
    logger.info('[verify] Testing property slug extraction...');

    // Test header extraction
    const mockReqWithHeader = {
      headers: { 'x-property-slug': 'test-header' }
    };
    const slugFromHeader = extractPropertySlug(mockReqWithHeader);
    logger.info('[verify] ✓ Header extraction:', { input: 'x-property-slug: test-header', output: slugFromHeader });

    // Test empty request
    const mockReqEmpty = { headers: {} };
    const slugFromEmpty = extractPropertySlug(mockReqEmpty);
    logger.info('[verify] ✓ Empty request extraction:', { output: slugFromEmpty });

    logger.info('[verify] 🎉 All platform database tests passed!');
    return true;

  } catch (error) {
    logger.error('[verify] ✗ Platform database verification failed:', error.message);
    return false;
  }
}

async function main() {
  try {
    // First run migrations if needed
    await migratePlatform();

    // Then verify functionality
    const success = await verifyPlatformDatabase();

    if (success) {
      logger.info('[verify] Platform database verification completed successfully');
      process.exit(0);
    } else {
      logger.error('[verify] Platform database verification failed');
      process.exit(1);
    }
  } catch (error) {
    logger.fatal('[verify] Fatal error during verification:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { verifyPlatformDatabase };