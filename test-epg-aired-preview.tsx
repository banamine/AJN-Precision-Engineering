import React from 'react';
import { createRoot } from 'react-dom/client';
import './src/index.css';
import EpgGuide from './src/EpgGuide';
import { setCachedSchedule } from './src/guide/scheduleCache';
import type { Program, ScheduleChannel } from './src/types';

const now = new Date();
const nowHour = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
const startHour = Math.min(23.5, nowHour + 0.05);
const endHour = Math.min(24, nowHour + 1.2);
const fixtures = [
  ['synthetic-fox', 'DEMO — FOX News fixture', '2026-10-08T21:00:00.000Z'],
  ['synthetic-cnn', 'DEMO — CNN fixture', '2026-10-09T22:00:00.000Z'],
  ['synthetic-bbc', 'DEMO — BBC fixture', '2026-10-10T23:00:00.000Z'],
] as const;

const channels: ScheduleChannel[] = fixtures.map(([id, name, airedUtc], index) => {
  const program: Program = {
    id: `${id}-program`,
    guideId: 'classic-tv',
    channelId: id,
    title: `SYNTHETIC REPLAY — fixture ${index + 1}`,
    startTime: startHour,
    endTime: endHour,
    startHour,
    endHour,
    mediaType: 'video',
    mediaUrl: `/synthetic/${id}.mp4`,
    archivePath: `/synthetic/${id}.mp4`,
    metadata: { airedUtc },
  };
  return {
    id, guideId: 'classic-tv', name, logo: '/test-epg-aired-preview-logo.svg',
    mediaType: 'video', group: 'Synthetic fixture',
    programs: [program], sourceStatus: 'snapshot',
  };
});

setCachedSchedule('classic-tv', channels);
const root = document.getElementById('root');
if (!root) throw new Error('Missing preview root');
createRoot(root).render(<EpgGuide guideId="classic-tv" active={false} />);
