import { vi } from 'vitest';

// Polyfill crypto.randomUUID for tests if not available
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () => '00000000-0000-0000-0000-000000000000',
  });
}

// Provide a minimal fetch mock shape for tests that do not hit the network.
vi.stubGlobal('fetch', vi.fn());
