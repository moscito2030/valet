'use client';

import dynamic from 'next/dynamic';

// Keep the event/Viewer graph out of the competition homepage's initial bundle.
// The client boundary is required for code splitting in this Next.js version.
const Scoreboard = dynamic(() => import('./scoreboard'));

export default function EventScoreboard() {
  return <Scoreboard />;
}
