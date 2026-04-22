'use strict';

const PLATFORM_MIGRATIONS = [
  {
    id: '001_platform_registry',
    async up(client) {
      // Properties registry - stores all residential complexes managed by the platform
      await client.query(`
        CREATE TABLE IF NOT EXISTS properties (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          slug VARCHAR(50) UNIQUE NOT NULL,  -- e.g. 'zamoskv', 'noviy-arbat'
          name VARCHAR(255) NOT NULL,
          address TEXT,
          db_connection_url TEXT NOT NULL,   -- points to this property's own PostgreSQL DB
          is_active BOOLEAN DEFAULT true,    -- false = property disabled, returns 503
          plan VARCHAR(50) DEFAULT 'standard' CHECK (plan IN ('standard', 'premium', 'enterprise')),
          timezone VARCHAR(100) DEFAULT 'Europe/Moscow',
          contact_email VARCHAR(255),
          contact_phone VARCHAR(50),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`CREATE INDEX IF NOT EXISTS idx_properties_slug ON properties(slug)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_properties_active ON properties(is_active) WHERE is_active = true`);

      // Platform administrators - superadmins who manage all properties
      await client.query(`
        CREATE TABLE IF NOT EXISTS platform_admins (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          name VARCHAR(255),
          is_active BOOLEAN DEFAULT true,
          last_login_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`CREATE INDEX IF NOT EXISTS idx_platform_admins_email ON platform_admins(email)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_platform_admins_active ON platform_admins(is_active) WHERE is_active = true`);

      // Platform audit log - tracks all administrative actions
      await client.query(`
        CREATE TABLE IF NOT EXISTS platform_audit_log (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          admin_id UUID REFERENCES platform_admins(id),
          action VARCHAR(100) NOT NULL,  -- 'property.created', 'property.disabled', etc.
          property_id UUID REFERENCES properties(id),
          details JSONB,
          ip_address VARCHAR(45),
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`CREATE INDEX IF NOT EXISTS idx_platform_audit_admin ON platform_audit_log(admin_id, created_at DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_platform_audit_property ON platform_audit_log(property_id, created_at DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_platform_audit_action ON platform_audit_log(action, created_at DESC)`);

      // Seed: insert Rezidentsii Zamoskvorech'ya as first property
      // db_connection_url will be dynamically set via env var ZAMOSKV_DB_URL
      const zamoskvDbUrl = process.env.ZAMOSKV_DB_URL || process.env.DATABASE_URL;
      if (zamoskvDbUrl) {
        await client.query(`
          INSERT INTO properties (slug, name, address, db_connection_url, is_active, plan, contact_email)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (slug) DO NOTHING
        `, [
          'zamoskv',
          'Резидентные дома Замоскворечья',
          'г. Москва, Замоскворецкий район',
          zamoskvDbUrl,
          true,
          'premium',
          process.env.CONTACT_EMAIL || 'admin@zamoskv.ru'
        ]);
      }
    },
  },
  {
    id: '002_properties_feature_flags',
    async up(client) {
      // Add feature_flags JSONB column for per-property feature toggle storage.
      // Default '{}' means resolveFlags() will fall back to registry defaults for
      // all flags, keeping existing properties fully functional after the migration.
      await client.query(`
        ALTER TABLE properties
          ADD COLUMN IF NOT EXISTS feature_flags JSONB DEFAULT '{}'
      `);

      // updated_at is already defined in migration 001 but was added without a
      // trigger. Using IF NOT EXISTS is safe here — no-op if the column exists.
      await client.query(`
        ALTER TABLE properties
          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()
      `);
    },
  },
  {
    id: '003_properties_hostname',
    async up(client) {
      // Hybrid tenant resolver (hostname > X-Property-Slug header > JWT claim)
      // needs a reliable hostname → property mapping.  The column is nullable
      // so legacy deployments (single-tenant, dev, test) keep working — if a
      // property has no hostname, the resolver falls back to the header/JWT
      // sources.
      //
      // Stored lowercase to simplify case-insensitive lookups; the resolver
      // normalises incoming Host headers the same way before querying.
      await client.query(`
        ALTER TABLE properties
          ADD COLUMN IF NOT EXISTS hostname VARCHAR(255)
      `);

      // Partial unique index: two properties can both have hostname=NULL, but
      // any non-null hostname must be globally unique — otherwise the resolver
      // couldn't pick a deterministic tenant.
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_properties_hostname
          ON properties(hostname)
          WHERE hostname IS NOT NULL
      `);

      // Seed: stamp the default hostname for the first property from env so
      // the existing zamoskv row starts answering to its subdomain without
      // manual ops intervention.  If the env var isn't set (dev/test), we
      // leave it null — the header/JWT sources will carry the resolver.
      const zamoskvHostname = (process.env.ZAMOSKV_HOSTNAME || '').trim().toLowerCase();
      if (zamoskvHostname) {
        await client.query(`
          UPDATE properties
             SET hostname = $1,
                 updated_at = NOW()
           WHERE slug = 'zamoskv'
             AND hostname IS NULL
        `, [zamoskvHostname]);
      }
    },
  },
];

const LATEST_PLATFORM_MIGRATION_ID = PLATFORM_MIGRATIONS[PLATFORM_MIGRATIONS.length - 1]?.id || null;

module.exports = { PLATFORM_MIGRATIONS, LATEST_PLATFORM_MIGRATION_ID };