export default function manifest() {
  return {
    name: 'SignBridge AI - Nigerian Sign Language Bridge',
    short_name: 'SignBridge AI',
    description: 'Mobile-first assistive communication platform for Nigerian Sign Language to speech interpretation.',
    start_url: '/',
    display: 'standalone' as const,
    background_color: '#060a14',
    theme_color: '#060a14',
    icons: [
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
