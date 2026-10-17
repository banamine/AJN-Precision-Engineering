import express from 'express';
import assert from 'node:assert/strict';
import { registerNowPlayingRoute } from './server/radioNowPlayingRoute.ts';
import { createNowPlayingService } from './server/radioNowPlayingRoute.ts';
const app = express();
registerNowPlayingRoute(app, createNowPlayingService(async () => ({ status: 200, text: '<nowplaying-info-list><property name="cue_title"><![CDATA[Hi]]></property><property name="track_artist_name"><![CDATA[Yo]]></property><property name="cue_time_start"><![CDATA[' + Date.now() + ']]></property></nowplaying-info-list>', lastModified: null })));
const srv = app.listen(0, async () => {
  const port = (srv.address() as any).port, g = async (q: string) => { const r = await fetch(`http://127.0.0.1:${port}/api/live-radio/nowplaying${q}`); return [r.status, r.headers.get('cache-control'), await r.json()] as const; };
  const a = await g('?id=radio:ca-cjad'); assert.equal(a[0], 200); assert.equal(a[1], 'no-store'); assert.equal(a[2].current.title, 'Hi');
  assert.equal((await g('?id=radio:nope'))[2].state, 'unsupported');
  assert.equal((await g(''))[0], 400);
  assert.equal((await g('?id[]=x'))[0], 400);
  console.log('PASS route http'); srv.close();
});
