export type Destination = 'home' | 'tv-guide' | 'player' | 'library' | 'search' | 'dev';

export type MediaType = 'video' | 'audio';

export interface Guide {
  id: string;
  name: string;
  type: MediaType;
  enabled: boolean;
  description?: string;
}

export interface ChannelSource {
  id: string;
  channelId: string;
  protocol: 'http' | 'https' | 'hls' | 'custom' | 'direct_archive';
  url: string;
  title?: string;
  type?: string;
  priority: number;
  enabled: boolean;
  metadata?: Record<string, any>;
}

export interface Channel {
  id: string;
  guideId: string;
  name: string;
  mediaType: MediaType;
  logo?: string;
  group?: string;
  tvgId?: string;
  tvgName?: string;
  enabled: boolean;
  sources?: ChannelSource[];
}

export interface Program {
  id: string;
  guideId: string;
  channelId: string;
  title: string;
  description?: string;
  startTime: number;
  endTime: number;
  startHour?: number;
  endHour?: number;
  mediaType: MediaType;
  mediaUrl: string;
  archivePath?: string;
  metadata?: Record<string, any>;
}

export interface Playlist {
  id: string;
  name: string;
  sourceUrl: string;
  category: 'News' | 'TV Shows' | 'Movies' | string;
  enabled: boolean;
  lastSyncedAt: string;
  syncStatus: 'synced' | 'pending' | 'failed';
  itemCount?: number;
  rawM3u?: string;
}

export interface MediaItem {
  id: string;
  title: string;
  mediaType: MediaType;
  url: string;
  archivePath?: string;
  channelId?: string;
  guideId?: string;
  category?: string;
  duration?: string;
  metadata?: Record<string, any>;
}

export interface ScheduleChannel {
  id: string;
  guideId: string;
  name: string;
  mediaType: MediaType;
  group?: string;
  logo?: string;
  programs: Program[];
}

export interface NowPlayingMedia {
  programId?: string;
  sourceId?: string;
  assetId?: string;
  src: string;
  title: string;
  subtitle?: string;
  channelName?: string;
  channelId?: string;
  guideId?: string;
  mediaType?: MediaType;
  archivePath?: string;
  thumbnailUrl?: string;
  duration?: string;
  isLive?: boolean;
}

export interface LibraryItem {
  id: string;
  title: string;
  category: 'news' | 'classics' | 'science' | 'audio' | 'documentary';
  description: string;
  archivePath: string;
  duration: string;
  format: string;
  year?: string;
  source: string;
  thumbnailUrl?: string;
  featured?: boolean;
  tags: string[];
}

export interface ProxyStats {
  totalRequests: number;
  successfulRequests: number;
  retriedRequests: number;
  failedRequests: number;
  cacheHits: number;
  lastUpstreamLatencyMs: number;
  activeStreams: number;
}

export interface HealthResponse {
  status: string;
  service: string;
  uptime: number;
  timestamp: string;
  stats: ProxyStats;
}

export interface ProbeResult {
  path: string;
  status: number;
  ok: boolean;
  contentType?: string;
  contentLength?: string;
  acceptRanges?: string;
  proxyUrl: string;
  latencyMs: number;
  error?: string;
}

export type PlayProgramCallback = (
  archivePath: string,
  title: string,
  subtitle?: string,
  mediaType?: MediaType,
  channelId?: string,
  guideId?: string,
  programId?: string,
  sourceId?: string,
  assetId?: string
) => void;
