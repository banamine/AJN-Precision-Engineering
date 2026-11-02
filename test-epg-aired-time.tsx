import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { EpgProgramBlock } from './src/EpgGuide';
import type { Program, ScheduleChannel } from './src/types';

const channel: ScheduleChannel = {
  id: 'synthetic-news',
  guideId: 'classic-tv',
  name: 'Synthetic News',
  mediaType: 'video',
  group: 'Synthetic fixtures',
  programs: [],
};

function render(program: Program): string {
  return renderToStaticMarkup(EpgProgramBlock({
    program,
    channel,
    guideId: 'classic-tv',
    idx: 0,
    isLive: false,
    left: 0,
    width: 240,
  }));
}

const validAiredUtc = '2026-10-08T21:00:00.000Z';
const validProgram: Program = {
  id: 'synthetic-replay-valid',
  guideId: 'classic-tv',
  channelId: channel.id,
  title: 'Synthetic replay fixture',
  startTime: 18,
  endTime: 19,
  mediaType: 'video',
  mediaUrl: '/synthetic/valid.mp4',
  metadata: { airedUtc: validAiredUtc },
};
const validMarkup = render(validProgram);
const localLabel = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
}).format(new Date(validAiredUtc));
assert.match(validMarkup, new RegExp(`Aired ${localLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
assert.match(validMarkup, /title="Aired UTC: 2026-10-08T21:00:00\.000Z"/);
assert.match(validMarkup, /aria-label="Synthetic replay fixture, Synthetic News, Aired /);
assert.match(validMarkup, /data-testid="epg-aired-time"/);
console.log('PASS valid airedUtc → visible local “Aired” label, explicit UTC tooltip, accessible name');

const visibilityEvents: string[] = [];
const interactiveBlock = EpgProgramBlock({
  program: validProgram,
  channel,
  guideId: 'classic-tv',
  idx: 0,
  isLive: false,
  left: 0,
  width: 240,
  onAiredTimeVisibilityChange: (_target, label) => visibilityEvents.push(label ?? 'hidden'),
});
const focusTarget = {} as HTMLButtonElement;
interactiveBlock.props.onFocus({ currentTarget: focusTarget });
interactiveBlock.props.onBlur({ currentTarget: focusTarget });
assert.deepEqual(visibilityEvents, [`Aired ${localLabel}`, 'hidden']);
console.log('PASS focus/blur exposes and dismisses the mobile aired-time overlay label');

const missingProgram: Program = { ...validProgram, id: 'synthetic-replay-missing', metadata: {} };
assert.doesNotMatch(render(missingProgram), /data-testid="epg-aired-time"|Aired UTC:/);
console.log('PASS missing airedUtc → no badge');

const malformedProgram: Program = {
  ...validProgram,
  id: 'synthetic-replay-malformed',
  metadata: { airedUtc: 'not-a-date' },
};
assert.doesNotMatch(render(malformedProgram), /data-testid="epg-aired-time"|Aired UTC:/);
console.log('PASS malformed airedUtc → no badge');
