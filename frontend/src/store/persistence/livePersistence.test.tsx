import fs from 'node:fs';
import path from 'node:path';

describe('live-mode persistence boundary', () => {
  test('bounded domain state clears PII slices instead of hydrating localStorage in live mode', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/store/boundedContexts/useDomainStates.ts'),
      'utf8',
    );

    expect(source).toContain('const [saved] = useState(() => (isDemoMode ? loadFromLS({ criticalOnly: true }) : null))');
    expect(source).toContain('if (isDemoMode) return;');
    expect(source).toContain('clearLS();');
    expect(source).toContain('useDebouncedSave(reqState, saveRequests, isDemoMode)');
  });
});
