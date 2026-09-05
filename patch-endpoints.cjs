const fs = require('fs');

const serverFile = 'server.ts';
let content = fs.readFileSync(serverFile, 'utf8');

const importsToAdd = `
import {
  getGuideById, getChannelsByGuide, getChannelById, getChannelSources,
  addChannelSource, getAllPlaylists, syncPlaylist, getScheduleForGuide
} from './guideRegistry';
`;

content = content.replace(
  'import { getAllGuides, getPlaylistById, ingestM3uPlaylist } from "./guideRegistry";',
  'import { getAllGuides, getPlaylistById, ingestM3uPlaylist, getGuideById, getChannelsByGuide, getChannelById, getChannelSources, addChannelSource, getAllPlaylists, syncPlaylist, getScheduleForGuide } from "./guideRegistry";'
);

const routesToAdd = `
app.use(express.json());

app.get('/api/guides/:guideId', (req, res) => { const g = getGuideById(req.params.guideId); if (!g) return res.status(404).json({ error: \`Guide not found: \${req.params.guideId}\` }); res.json(g); });
app.get('/api/channels', (req, res) => { const guideId = req.query.guide as string | undefined; const channels = getChannelsByGuide(guideId); res.json({ guideId: guideId || 'all', total: channels.length, channels }); });
app.get('/api/channels/:channelId', (req, res) => { const c = getChannelById(req.params.channelId); if (!c) return res.status(404).json({ error: \`Channel not found: \${req.params.channelId}\` }); res.json(c); });
app.get('/api/channels/:channelId/sources', (req, res) => res.json({ channelId: req.params.channelId, total: getChannelSources(req.params.channelId).length, sources: getChannelSources(req.params.channelId) }));
app.post('/api/channels/:channelId/sources', (req, res) => { const { url, protocol, priority, enabled, metadata } = req.body; if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Source URL is required' }); res.status(201).json({ message: 'Channel source added successfully', source: addChannelSource(req.params.channelId, { url, protocol, priority, enabled, metadata }) }); });
app.get('/api/schedule', async (req, res) => { const guideId = (req.query.guide as string) || 'cable-tv'; try { res.json({ guideId, channels: await getScheduleForGuide(guideId), generatedAt: new Date().toISOString(), source: 'archive.org-live' }); } catch (e) { console.error('[Schedule]', e); res.status(500).json({ error: 'Failed to generate schedule data', channels: [] }); } });
app.get('/api/playlists', (_req, res) => { const playlists = getAllPlaylists(); res.json({ playlists, total: playlists.length }); });
app.get('/api/playlists/:playlistId', (req, res) => { const p = getPlaylistById(req.params.playlistId); if (!p) return res.status(404).json({ error: \`Playlist not found: \${req.params.playlistId}\` }); res.json(p); });
app.post('/api/playlists/:playlistId/sync', (req, res) => { const r = syncPlaylist(req.params.playlistId, req.body?.customM3u); if (!r.success) return res.status(400).json({ error: \`Failed to sync playlist \${req.params.playlistId}\`, playlist: r.playlist }); res.json({ message: \`Playlist \${req.params.playlistId} synchronized successfully\`, playlist: r.playlist, ingestedCount: r.count }); });

`;

content = content.replace(
  'app.get("/api/guides", (_req, res) => res.json(getAllGuides()));',
  'app.get("/api/guides", (_req, res) => { const guides = getAllGuides(); res.json({ guides, total: guides.length }); });\n' + routesToAdd
);

fs.writeFileSync(serverFile, content);
