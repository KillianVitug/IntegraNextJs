"use client";

import "@/polyfills";

export default function PolyfillProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
