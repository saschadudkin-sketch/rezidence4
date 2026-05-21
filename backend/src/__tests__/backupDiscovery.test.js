'use strict';

const fs = require('node:fs');
const path = require('node:path');

describe('backup tenant discovery', () => {
  test('backup.sh discovers active tenant DBs from platform registry by default', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../backup.sh'), 'utf8');
    expect(source).toContain('discover_backup_targets()');
    expect(source).toContain('FROM properties');
    expect(source).toContain('db_connection_url');
    expect(source).toContain('COALESCE(is_active, true) = true');
  });

  test('backup.sh latest filenames do not include a newline-derived suffix', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../backup.sh'), 'utf8');
    expect(source).toContain("SAFE_LABEL=$(printf '%s' \"$LABEL\" | tr -c 'A-Za-z0-9_.-' '_')");
    expect(source).not.toContain('SAFE_LABEL=$(echo "$LABEL"');
  });
});
