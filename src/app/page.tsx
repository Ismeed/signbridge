import React from 'react';
import { CollectStudioClient, MainAppClient } from '@/components/AppShellClient';

export const dynamic = 'force-dynamic';

export default function Page() {
  const appMode = process.env.NEXT_PUBLIC_APP_MODE?.trim().toLowerCase();

  if (appMode === 'collector') {
    return <CollectStudioClient standalone />;
  }

  return <MainAppClient />;
}
