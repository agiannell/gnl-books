import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library only unmounts between tests on its own when Vitest globals are
// on; they are not, so do it here.
afterEach(cleanup);
