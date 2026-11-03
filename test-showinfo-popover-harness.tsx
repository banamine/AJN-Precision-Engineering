import React from 'react';
import { createRoot } from 'react-dom/client';
import { ShowInfoButton } from './src/components/ShowInfoButton';
import { buildFallbackShowInfo } from './src/showinfo/fallback';
import './src/index.css';

const fixedAiredUtc = '2026-10-31T12:00:00.000Z';
const movieChannel = {
  id: 'fixture-movies-partition',
  name: 'Movies Classics · Pre-1940',
  group: 'Movies',
  mediaType: 'video',
  rotationTitleCount: 78,
  sourceStatus: 'snapshot',
  programs: Array.from({ length: 13 }, (_, index) => ({
    title: index === 12 ? 'Film 1' : `Film ${index}`,
    archivePath: `/download/fixture-movie-item/Film-${index}.mp4`,
    metadata: { airedUtc: fixedAiredUtc },
  })),
};
const newsChannel = {
  id: 'fixture-news-channel',
  name: 'Synthetic News Channel',
  group: 'News',
  mediaType: 'video',
  sourceStatus: 'snapshot',
  programs: [{
    title: 'Evening News',
    archivePath: '/download/fixture-news-item/evening-news.mp4',
    metadata: { airedUtc: fixedAiredUtc },
  }],
};

function Fixture({ id, fallback }: { id: string; fallback: ReturnType<typeof buildFallbackShowInfo> }) {
  return (
    <section data-testid={id} className="p-8 text-white">
      <p className="mb-2">{fallback.title}</p>
      <ShowInfoButton channelId={id} title={fallback.title} fallback={fallback} />
    </section>
  );
}

createRoot(document.getElementById('root')!).render(
  <main className="min-h-screen bg-neutral-950">
    <Fixture id="movies-fixture" fallback={buildFallbackShowInfo(movieChannel)} />
    <Fixture id="news-fixture" fallback={buildFallbackShowInfo(newsChannel)} />
  </main>,
);
