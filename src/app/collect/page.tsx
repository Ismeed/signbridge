import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CollectStudioClient } from '@/components/AppShellClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'SignBridge NSL Data Studio',
  description: 'Team Nigerian Sign Language (NSL) video landmark collection and model training portal.',
};

export default function CollectPage() {
  const appMode = process.env.NEXT_PUBLIC_APP_MODE?.trim().toLowerCase();

  if (appMode === 'consumer') {
    notFound();
  }

  return <CollectStudioClient standalone={appMode === 'collector'} />;
}
