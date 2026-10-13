import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 1. Check index.css has the keyframe animation, glowing red ring, and reduced-motion override
const indexCss = readFileSync('src/index.css', 'utf8');
assert.ok(indexCss.includes('@keyframes muteRingPulse'), 'index.css must define @keyframes muteRingPulse');
assert.ok(indexCss.includes('.mute-indicator-ring'), 'index.css must define .mute-indicator-ring');
assert.ok(indexCss.includes('rgba(239, 68, 68'), 'index.css must use red glowing colors');
assert.ok(indexCss.includes('prefers-reduced-motion: reduce'), 'index.css must support prefers-reduced-motion');
assert.ok(indexCss.includes('animation: none !important'), 'index.css must disable pulsing under reduced-motion');

// 2. Check PlayerChrome.tsx has mute indicators on both video and audio playback views
const chrome = readFileSync('src/components/PlayerChrome.tsx', 'utf8');
const muteButtonOccurrences = (chrome.match(/data-testid="mute-button"/g) || []).length;
assert.equal(muteButtonOccurrences, 2, 'PlayerChrome must have mute buttons in both video and audio views');

const muteIndicatorClassOccurrences = (chrome.match(/mute-indicator-ring/g) || []).length;
assert.equal(muteIndicatorClassOccurrences, 2, 'PlayerChrome must apply mute-indicator-ring in both views');

// Verify accessible labels in PlayerChrome
assert.ok(chrome.includes('aria-label={p.isMuted ? "Muted — click to unmute" : "Unmuted — click to mute"}'), 'PlayerChrome must have accessible aria-label with Muted/Unmuted states');
assert.ok(chrome.includes('aria-pressed={p.isMuted}'), 'PlayerChrome must set aria-pressed for mute button');
assert.ok(chrome.includes('<span className="sr-only">{p.isMuted ? "Muted" : "Unmuted"}</span>'), 'PlayerChrome must contain sr-only text for screen readers');

// 3. Check MiniPlayerDock.tsx has mute indicator
const miniPlayer = readFileSync('src/components/MiniPlayerDock.tsx', 'utf8');
assert.ok(miniPlayer.includes('data-testid="mute-button"'), 'MiniPlayerDock must have a mute button');
assert.ok(miniPlayer.includes('mute-indicator-ring'), 'MiniPlayerDock must apply mute-indicator-ring when muted');
assert.ok(miniPlayer.includes('aria-label={muted ? "Muted — click to unmute" : "Unmuted — click to mute"}'), 'MiniPlayerDock must have accessible aria-label');

// 4. Check MinimalPlayer.tsx starts muted on fresh launch and handles user interaction unmuting
const mp = readFileSync('src/MinimalPlayer.tsx', 'utf8');
assert.ok(mp.includes('let sessionUnmuted = false;'), 'MinimalPlayer must initialize sessionUnmuted to false for fresh launch');
assert.ok(mp.includes('const [isMuted, setIsMuted] = useState(() => !sessionUnmuted);'), 'MinimalPlayer must initialize isMuted based on !sessionUnmuted');
assert.ok(mp.includes('volumechange'), 'MinimalPlayer must listen to volumechange to keep indicator matching playback state');
assert.ok(mp.includes('onUserInteraction'), 'MinimalPlayer must listen for user interaction to unmute playback on launch');
assert.ok(mp.includes('sessionUnmuted = true;'), 'MinimalPlayer must update sessionUnmuted to true upon unmuting');

// 5. Check usePersistentMedia.ts provides muted state and volumechange tracking
const persistent = readFileSync('src/hooks/usePersistentMedia.ts', 'utf8');
assert.ok(persistent.includes('muted: boolean;'), 'usePersistentMedia must expose muted property');
assert.ok(persistent.includes('volumechange'), 'usePersistentMedia must listen to volumechange');
assert.ok(persistent.includes('toggleMute'), 'usePersistentMedia must expose toggleMute');

console.log('PASS: Audio and video player mute indicator and behavior tests all passed');
