import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import PolyfillProvider from "@/components/PolyfillProvider";

export const metadata: Metadata = {
  title: {
    template: '%s | Integra',
    default: 'Integra',
  },
  description: "Based on Integra",
  applicationName: "Human Resource Management"
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <PolyfillProvider>
          <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem
              disableTransitionOnChange
            >
          {children}
          <Toaster />
          </ThemeProvider>
        </PolyfillProvider>
      </body>
    </html>
  );
}
