import express from 'express';
import { buildChannelFromSearch, searchArchiveGeneral } from './archive-discovery.js';
import { addChannelSource } from './guideRegistry.js';
import { fetchAjnFeed, getAjnAffiliateLinks, getAjnResource, getAjnResources, getAjnStreams, type AjnFeedId } from './ajnResourceService.js';

const AJN_FEED_IDS: AjnFeedId[] = ['Alex', 'WarRoom', 'SundayLive', 'AJNHourlyVideo', 'AJNHourlyAudio'];

export function patchServer(app: express.Express) {
  app.get('/api/search/collection', async (req, res) => {
    try {
      const query = (req.query.q as string) || '';
      const docs = await searchArchiveGeneral(query);
      res.json({ total: docs.length, items: docs });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/channels/build', async (req, res) => {
    try {
      const { query, channelId, channelName } = req.body;
      if (!query || !channelId) return res.status(400).json({ error: "Missing query or channelId" });
      const channel = await buildChannelFromSearch(query, channelId, channelName || channelId);
      res.json(channel);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // AJN Resource Contract: the application consumes the authoritative RSS indexes
  // published at rss.alexjones.media instead of substituting Archive.org discovery.
  app.get('/api/ajn/resources', (_req, res) => {
    res.json({
      source: 'https://rss.alexjones.media/',
      resources: getAjnResources(),
      streams: getAjnStreams(),
      affiliates: getAjnAffiliateLinks(),
      total: getAjnResources().length,
    });
  });

  app.get('/api/ajn/resources/:feedId', async (req, res) => {
    const feedId = req.params.feedId as AjnFeedId;
    const resource = getAjnResource(feedId);
    if (!resource || !AJN_FEED_IDS.includes(feedId)) {
      return res.status(404).json({ error: `Unknown AJN feed: ${req.params.feedId}`, available: AJN_FEED_IDS });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const feed = await fetchAjnFeed(feedId, controller.signal);
      res.json(feed);
    } catch (e: any) {
      const aborted = e?.name === 'AbortError';
      res.status(aborted ? 504 : 502).json({
        error: aborted ? 'AJN RSS request timed out' : e?.message || 'AJN RSS request failed',
        resource,
      });
    } finally {
      clearTimeout(timer);
    }
  });

  app.get('/api/ajn/status', async (_req, res) => {
    const results = await Promise.all(AJN_FEED_IDS.map(async feedId => {
      const started = Date.now();
      try {
        const feed = await fetchAjnFeed(feedId);
        return {
          id: feedId,
          name: feed.resource.name,
          rssUrl: feed.resource.rssUrl,
          htmlUrl: feed.resource.htmlUrl,
          ok: true,
          itemCount: feed.items.length,
          rawBytes: feed.rawBytes,
          latencyMs: Date.now() - started,
          fetchedAt: feed.fetchedAt,
        };
      } catch (e: any) {
        return {
          id: feedId,
          name: getAjnResource(feedId)?.name,
          rssUrl: getAjnResource(feedId)?.rssUrl,
          htmlUrl: getAjnResource(feedId)?.htmlUrl,
          ok: false,
          itemCount: 0,
          latencyMs: Date.now() - started,
          error: e?.message || 'AJN RSS request failed',
        };
      }
    }));
    const healthy = results.filter(result => result.ok).length;
    res.status(healthy === results.length ? 200 : 207).json({
      source: 'https://rss.alexjones.media/',
      checkedAt: new Date().toISOString(),
      healthy,
      total: results.length,
      feeds: results,
    });
  });
}
