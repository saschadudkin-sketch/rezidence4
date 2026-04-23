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
  {
    // Phase 1 of the D-lite refactor (see ROADMAP.md): bring the `properties`
    // table closer to the access-platform spec (docs/product/specs/
    // domhub-access-data-model-spec.md §5 and RECONCILIATION.md §1.1).
    //
    // Everything added here is nullable or defaulted so existing rows — most
    // notably the seeded zamoskv — stay valid.  We do NOT drop `is_active`
    // yet: it is still written/read by legacy routes; it will be retired in
    // a later migration once all callsites use `status`.
    id: '004_properties_full_spec',
    async up(client) {
      // property_type — classifies the object.  Defaults to 'residential_complex'
      // which is what zamoskv is; future cottage communities / club houses
      // pick their own value at creation time.
      await client.query(`
        ALTER TABLE properties
          ADD COLUMN IF NOT EXISTS property_type VARCHAR(30)
            NOT NULL DEFAULT 'residential_complex'
            CHECK (property_type IN ('residential_complex', 'club_house', 'cottage_community'))
      `);

      // status — richer lifecycle than the binary is_active.  Seeded from
      // is_active so existing rows keep the same effective state:
      //   is_active=true  → status='active'
      //   is_active=false → status='suspended'  (most common reason for disable today)
      // admins can later refine suspended rows to 'maintenance' / 'terminated'.
      await client.query(`
        ALTER TABLE properties
          ADD COLUMN IF NOT EXISTS status VARCHAR(20)
            NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'suspended', 'maintenance', 'terminated'))
      `);
      await client.query(`
        UPDATE properties
           SET status = CASE WHEN is_active THEN 'active' ELSE 'suspended' END
         WHERE status = 'active' AND is_active = false
      `);

      // Branding: surfaces in the tenant SPA header and in the superadmin
      // property detail page.  Both nullable — existing properties render
      // the platform default until a logo/color is set explicitly.
      await client.query(`
        ALTER TABLE properties
          ADD COLUMN IF NOT EXISTS logo_url TEXT
      `);
      await client.query(`
        ALTER TABLE properties
          ADD COLUMN IF NOT EXISTS primary_color VARCHAR(20)
      `);

      // management_company_id — forward-compatible FK for the org layer
      // introduced in migration 005.  Nullable because zamoskv (and any
      // seeded-before-UK rows) have no parent MC until one is created and
      // the property is reassigned from the superadmin SPA.  The FK itself
      // is added in 005 after `management_companies` exists.
      await client.query(`
        ALTER TABLE properties
          ADD COLUMN IF NOT EXISTS management_company_id UUID
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_properties_management_company
          ON properties(management_company_id)
          WHERE management_company_id IS NOT NULL
      `);
    },
  },
  {
    // Phase 1 continued: introduce the management-company layer.  The tables
    // are seeded empty — the only tenant today (zamoskv) is self-managed.
    // When the first real MC onboards, a platform_admin creates a row here
    // and reassigns properties via the superadmin SPA.  Keeping the schema
    // in place now means we don't have to rewrite audit_log / audit queries
    // when that happens.
    id: '005_management_companies',
    async up(client) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS management_companies (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          slug VARCHAR(80) UNIQUE NOT NULL,
          name VARCHAR(255) NOT NULL,
          inn VARCHAR(20),                        -- Russian tax ID; useful for billing & legal
          contact_email VARCHAR(255),
          contact_phone VARCHAR(50),
          website VARCHAR(255),
          logo_url TEXT,
          status VARCHAR(20) NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'suspended', 'terminated')),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_management_companies_slug
          ON management_companies(slug)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_management_companies_status
          ON management_companies(status)
          WHERE status = 'active'
      `);

      // Add the FK from properties now that the target table exists.
      // Guarded with a catch-all DO block so re-running on a DB that already
      // has the constraint is a no-op (pg doesn't support `IF NOT EXISTS`
      // on ADD CONSTRAINT until PG 9.6+, and even then only for some forms).
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
             WHERE constraint_name = 'fk_properties_management_company'
               AND table_name = 'properties'
          ) THEN
            ALTER TABLE properties
              ADD CONSTRAINT fk_properties_management_company
              FOREIGN KEY (management_company_id)
              REFERENCES management_companies(id)
              ON DELETE SET NULL;
          END IF;
        END $$;
      `);

      // Admins scoped to a specific MC.  Mirrors platform_admins shape so
      // auth middleware can reuse the same bcrypt + JWT plumbing; the role
      // gate on the routes decides what each admin can actually see.
      await client.query(`
        CREATE TABLE IF NOT EXISTS management_company_admins (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          management_company_id UUID NOT NULL REFERENCES management_companies(id) ON DELETE CASCADE,
          email VARCHAR(255) NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          name VARCHAR(255),
          is_active BOOLEAN DEFAULT true,
          last_login_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(management_company_id, email)
        )
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_mc_admins_email
          ON management_company_admins(email)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_mc_admins_active
          ON management_company_admins(management_company_id, is_active)
          WHERE is_active = true
      `);
    },
  },
  {
    // Phase 1 final step: extend platform_audit_log so it can describe
    // actions by parties other than platform_admins (system jobs, MC admins
    // once those exist, and — eventually — external integrations replaying
    // events).  Shape per RECONCILIATION.md §1.2.
    //
    // Strategy:
    //   - add actor_type with a default of 'platform_admin' so existing rows
    //     get a correct retroactive label
    //   - relax admin_id to allow NULL for system-originated events
    //   - widen ip_address to INET (proper type; the VARCHAR(45) was chosen
    //     only because PG's INET wasn't obvious at the time)
    //   - add management_company_id so MC-scoped audit trails can be
    //     filtered without joining through properties
    id: '006_platform_audit_log_full',
    async up(client) {
      await client.query(`
        ALTER TABLE platform_audit_log
          ADD COLUMN IF NOT EXISTS actor_type VARCHAR(30)
            NOT NULL DEFAULT 'platform_admin'
            CHECK (actor_type IN ('platform_admin', 'management_company_admin', 'system', 'integration'))
      `);

      // Drop NOT NULL if it was set (migration 001 didn't declare it, but
      // some deployments may have tightened it manually).  Using DO block
      // because ALTER COLUMN ... DROP NOT NULL is not idempotent by name.
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_name = 'platform_audit_log'
               AND column_name = 'admin_id'
               AND is_nullable = 'NO'
          ) THEN
            ALTER TABLE platform_audit_log ALTER COLUMN admin_id DROP NOT NULL;
          END IF;
        END $$;
      `);

      await client.query(`
        ALTER TABLE platform_audit_log
          ADD COLUMN IF NOT EXISTS management_company_id UUID REFERENCES management_companies(id)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_platform_audit_actor_type
          ON platform_audit_log(actor_type, created_at DESC)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_platform_audit_mc
          ON platform_audit_log(management_company_id, created_at DESC)
          WHERE management_company_id IS NOT NULL
      `);

      // Widen ip_address to INET if still VARCHAR.  The USING cast below
      // accepts both IPv4 and IPv6 string forms that the old column could
      // legally hold.  Done conditionally so replays are no-ops.
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_name = 'platform_audit_log'
               AND column_name = 'ip_address'
               AND data_type = 'character varying'
          ) THEN
            ALTER TABLE platform_audit_log
              ALTER COLUMN ip_address TYPE INET
              USING NULLIF(ip_address, '')::INET;
          END IF;
        END $$;
      `);
    },
  },
];

const LATEST_PLATFORM_MIGRATION_ID = PLATFORM_MIGRATIONS[PLATFORM_MIGRATIONS.length - 1]?.id || null;

module.exports = { PLATFORM_MIGRATIONS, LATEST_PLATFORM_MIGRATION_ID };