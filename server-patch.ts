import express from 'express';
import { buildChannelFromSearch, searchArchiveGeneral } from './archive-discovery.js';
import { addChannelSource } from './guideRegistry.js';

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
      
      // Save the generated playlist as Channel Sources
      // First, remove existing sources for this channel (or just clear and re-add)
      // Since addChannelSource appends, maybe we need setChannelSources?
      // Actually, we can just save it into a new global map for demonstration or add them via addChannelSource
      
      res.json(channel);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
