import React from 'react';
import './globals.css';

export const viewport = {
  themeColor: '#060a14',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export const metadata = {
  title: 'SignBridge AI | Nigerian Sign Language Translation Platform',
  description:
    'Bridging deaf and hearing communication through accessible sign gesture vision and multilingual Nigerian speech output.',
  applicationName: 'SignBridge AI',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'SignBridge AI',
  },
  icons: {
    icon: '/favicon.ico',
    apple: '/icon-192.svg',
  },
  manifest: '/manifest.json',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased dark">
      <body className="min-h-full flex flex-col bg-[#060a14] text-slate-100 antialiased overflow-x-hidden selection:bg-cyan-500/30 selection:text-cyan-200">
        {children}
      </body>
    </html>
  );
}
