"use client"; // Error boundaries must be Client Components
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application global error", {
      digest: error.digest,
      message: error.message,
      stack: error.stack,
    });
  }, [error]);

  return (
    // global-error must include html and body tags
    <html>
      <body>
        <main style={{ padding: 24, textAlign: "center" }}>
          <h2>Something went wrong!</h2>
          {error.digest ? (
            <p>
              Error reference: <code>{error.digest}</code>
            </p>
          ) : null}
          <button onClick={() => reset()}>Try again</button>
        </main>
      </body>
    </html>
  );
}
