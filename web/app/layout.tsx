import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Chat Report',
  description: 'Upload a WhatsApp chat and get a candid, fact-based read.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  // Language and direction are set on <html> by the page once the viewer's choice is known.
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
