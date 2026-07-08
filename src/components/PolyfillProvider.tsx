'use client';

/**
 * Polyfills for Firefox 66 (April 2019) compatibility.
 *
 * Assignments run at MODULE EVALUATION TIME — before React renders any
 * children — so Radix UI components that call `new ResizeObserver()` during
 * their first mount already find the polyfill in place.
 *
 * Each assignment is guarded so modern browsers (Chrome 79+, Firefox 69+,
 * Edge 79+) that already have the native API are completely unaffected.
 */

import ResizeObserverPolyfill from 'resize-observer-polyfill';

// ResizeObserver: native in Firefox 69+. Required by @radix-ui/react-dropdown-menu,
// @radix-ui/react-popover, and @radix-ui/react-select for popup positioning.
if (typeof window !== 'undefined' && typeof window.ResizeObserver === 'undefined') {
  window.ResizeObserver = ResizeObserverPolyfill;
}

// queueMicrotask: native in Firefox 71+. Used by React 19's scheduler.
// React has an internal MessageChannel fallback but providing the standard
// API avoids any scheduling edge cases.
if (typeof window !== 'undefined' && typeof window.queueMicrotask !== 'function') {
  window.queueMicrotask = function queueMicrotask(callback: () => void): void {
    Promise.resolve()
      .then(callback)
      .catch((error) => setTimeout(() => { throw error; }, 0));
  };
}

export default function PolyfillProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
