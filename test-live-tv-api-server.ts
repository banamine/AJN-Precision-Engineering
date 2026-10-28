import { setLiveHealthAutoForTests, setLiveTvFetchForTests } from './guideRegistry.ts';
import { buildLiveTvNtdFixture } from './testFixtures/liveTvPinned.ts';

// Keep the fixture server in test mode; never switch to production mode to warm it.
process.env.NODE_ENV = 'test';
process.env.AJN_BOOT_WARMERS = '0';
setLiveHealthAutoForTests(false);
setLiveTvFetchForTests((async () => new Response(buildLiveTvNtdFixture(), { status: 200 })) as typeof fetch);

await import('./server.ts');
