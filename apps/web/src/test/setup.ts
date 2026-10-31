// Extends the global expect with jest-dom matchers (toBeInTheDocument, toHaveAccessibleName, …).
import '@testing-library/jest-dom/vitest';
import { tyhjennaListanJarjestys } from '@/tositteet/listanJarjestys';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// findBy*/waitFor default to 1 s, which the slower CI runner occasionally exceeds on heavy
// route renders (e.g. a new invoice navigating to its document).
configure({ asyncUtilTimeout: 5000 });

// jsdom implements neither scroll API; TanStack Router's scroll-restoration calls them on mount.
// Stub them so router renders don't emit noisy unhandled errors in the test output.
window.scrollTo = () => {};
Element.prototype.scrollIntoView = () => {};

// cmdk/Radix-style components probe pointer-capture + ResizeObserver, which jsdom lacks.
// Added only because the TiliValitsin picker tests need them (minimal stubs).
if (!HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
}
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Node >= 24 ships its own experimental `localStorage` global, and because jsdom's window IS
// globalThis here, that getter shadows jsdom's Storage — leaving an object with no getItem, so
// every localStorage test dies with "getItem is not a function". The repo targets Node 22
// (.nvmrc), where jsdom's own Storage wins and this branch never runs. Swap in a Storage-shaped
// stand-in only when the ambient one is unusable.
if (typeof globalThis.localStorage?.getItem !== 'function') {
  const arvot = new Map<string, string>();
  const varasto: Storage = {
    get length() {
      return arvot.size;
    },
    key: (i: number) => [...arvot.keys()][i] ?? null,
    getItem: (k: string) => arvot.get(k) ?? null,
    setItem: (k: string, v: string) => void arvot.set(k, String(v)),
    removeItem: (k: string) => void arvot.delete(k),
    clear: () => arvot.clear(),
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: varasto,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  cleanup();
  // Tositelista tallentaa näytetyn järjestyksensä (muisti + sessionStorage) selausta varten.
  tyhjennaListanJarjestys();
  // Näkymät muistavat suodattimensa localStorageen (lib/muisti.ts) — testit eivät saa vuotaa
  // valintoja toisilleen.
  try {
    window.localStorage.clear();
  } catch {
    // testi on voinut korvata localStoragen heittävällä
  }
});
