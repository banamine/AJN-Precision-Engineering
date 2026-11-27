import assert from 'node:assert/strict';
import test from 'node:test';
import { initialsOf, podcastArtFor, rememberChannelArts, rememberPodcastArt, resetPodcastArtForTests } from './podcastArt';

test('podcast art: only real artwork is remembered, by channel id', () => {
  resetPodcastArtForTests();
  rememberChannelArts([{ id: 'pod-a', logo: 'https://x/a.jpg' }, { id: 'pod-b' }, { id: 'tv-1', logo: 'https://x/tv.jpg' }, { id: 'pod-c', logo: 'javascript:alert(1)' }, null]);
  assert.equal(podcastArtFor('pod-a'), 'https://x/a.jpg');
  assert.equal(podcastArtFor('pod-b'), undefined);
  assert.equal(podcastArtFor('tv-1'), undefined);
  assert.equal(podcastArtFor('pod-c'), undefined);
  rememberPodcastArt('pod-d', '/api/img/d.jpg'); assert.equal(podcastArtFor('pod-d'), '/api/img/d.jpg');
  rememberPodcastArt('pod-a', undefined); assert.equal(podcastArtFor('pod-a'), 'https://x/a.jpg');
  assert.equal(podcastArtFor(null), undefined);
});
test('initials', () => { assert.equal(initialsOf('Chicks on the Right'), 'CO'); assert.equal(initialsOf('  '), '•'); assert.equal(initialsOf(undefined), '•'); });
