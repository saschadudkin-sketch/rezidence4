import { createBackendProvider } from './backendProvider';
import { createDemoProvider } from './demoProvider';
import { assertServiceContracts } from './ServiceContracts';

describe('Service contracts', () => {
  test('demo provider satisfies required contract surface', () => {
    expect(() => assertServiceContracts(createDemoProvider())).not.toThrow();
  });

  test('backend provider satisfies required contract surface', () => {
    expect(() => assertServiceContracts(createBackendProvider())).not.toThrow();
  });
});
