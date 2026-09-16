import express from 'express';
import { buildChannelFromSearch, searchArchiveGeneral } from './archive-discovery.js';
import { addChannelSource } from './guideRegistry.js';
import { getArchiveChannelPage, getArchiveChannelSummary, getArchiveProgramPage } from './src/archive-epg-loader.js';
import { getChannelsByGuide } from './guideRegistry.js';

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

  app.get('/api/epg/channels', (req, res) => {
    const guideId = (req.query.guide as string) || 'cable-tv';
    const channels = getChannelsByGuide(guideId).map(channel => ({
      id: channel.id,
      guideId: channel.guideId,
      name: channel.name,
      mediaType: channel.mediaType,
      group: channel.group,
      logo: channel.logo,
      tvgId: channel.tvgId,
      tvgName: channel.tvgName,
      enabled: channel.enabled,
    }));
    const page = getArchiveChannelPage(channels, req.query.offset, req.query.limit);
    res.json({ guideId, ...page, seedArchiveChannel: getArchiveChannelSummary() });
  });

  app.get('/api/epg/programs', (req, res) => {
    const channelId = String(req.query.channel || '');
    if (!channelId) return res.status(400).json({ error: 'channel is required' });
    const page = getArchiveProgramPage(channelId, req.query.offset, req.query.limit);
    res.json({ guideId: 'cable-tv', channelId, ...page });
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
}
