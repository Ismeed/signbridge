import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SignBridge AI - Nigerian Sign Language Bridge',
    short_name: 'SignBridge AI',
    description:
      'Mobile-first assistive communication platform for Nigerian Sign Language to speech interpretation.',
    start_url: '/',
    display: 'standalone',
    background_color: '#060913',
    theme_color: '#060913',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/icon-192.svg',
        sizes: '192x192',
        type: 'image/svg+xml',
      },
      {
        src: '/icon-512.svg',
        sizes: '512x512',
        type: 'image/svg+xml',
      },
    ],
  };
}
