import React from 'react';
import type { Metadata, Viewport } from 'next';
import './globals.css';

export const viewport: Viewport = {
  themeColor: '#060913',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: 'SignBridge AI | Nigerian Sign Language Translation',
  description:
    'Bridging deaf and hearing communication through local sign gesture vision and multilingual Nigerian speech output.',
  applicationName: 'SignBridge AI',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'SignBridge AI',
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { url: '/icon-192.svg', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
  },
  manifest: '/manifest.webmanifest',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased dark">
      <body className="min-h-full bg-[#060913] text-slate-100 antialiased overflow-x-hidden selection:bg-cyan-500/30 selection:text-cyan-200">
        {children}
      </body>
    </html>
  );
}
