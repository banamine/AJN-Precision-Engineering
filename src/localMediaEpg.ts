import { MediaType } from './types';

export const LOCAL_MEDIA_GUIDE_ID = 'local-media';
export const LOCAL_MEDIA_CHANNEL_ID = 'local-media-channel';
export const LOCAL_MEDIA_EXTENSIONS = ['.mp3', '.mp4', '.m4v', '.m4a', '.m4', '.mkv'] as const;

export interface LocalMediaEntry {
  id: string;
  name: string;
  mediaType: MediaType;
  mimeType: string;
  size: number;
  lastModified: number;
  objectUrl: string;
  source: 'local-file';
  directoryName?: string;
}

function extensionFor(name: string): string {
  const value = name.toLowerCase();
  const index = value.lastIndexOf('.');
  return index >= 0 ? value.slice(index) : '';
}

export function isSupportedLocalMediaFile(file: File): boolean {
  return LOCAL_MEDIA_EXTENSIONS.includes(extensionFor(file.name) as typeof LOCAL_MEDIA_EXTENSIONS[number]);
}

export function inferLocalMediaType(file: File): MediaType {
  return ['.mp3', '.m4a'].includes(extensionFor(file.name)) ? 'audio' : 'video';
}

function entryId(file: File): string {
  return ['local', file.name.toLowerCase(), file.size, file.lastModified].join(':');
}

function displayTitle(file: File): string {
  return file.name.replace(/\.[^.]+$/, '').replace(/[._-]+/g, ' ').trim() || file.name;
}

export function createLocalMediaEntry(file: File, directoryName?: string): LocalMediaEntry {
  return {
    id: entryId(file),
    name: displayTitle(file),
    mediaType: inferLocalMediaType(file),
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    lastModified: file.lastModified,
    objectUrl: URL.createObjectURL(file),
    source: 'local-file',
    directoryName,
  };
}

export function releaseLocalMediaEntry(entry: LocalMediaEntry): void {
  if (entry.objectUrl.startsWith('blob:')) URL.revokeObjectURL(entry.objectUrl);
}

export function buildLocalMediaChannel(entries: LocalMediaEntry[]) {
  return {
    id: LOCAL_MEDIA_CHANNEL_ID,
    guideId: LOCAL_MEDIA_GUIDE_ID,
    name: 'Local Files',
    mediaType: entries.some((entry) => entry.mediaType === 'video') ? 'video' as const : 'audio' as const,
    group: 'User Local Media',
    enabled: true,
    sources: entries.map((entry, index) => ({
      id: `src-${entry.id}`,
      channelId: LOCAL_MEDIA_CHANNEL_ID,
      protocol: 'https' as const,
      url: entry.objectUrl,
      priority: index + 1,
      enabled: true,
      metadata: {
        source: 'local-file',
        fileName: entry.name,
        mimeType: entry.mimeType,
        size: entry.size,
        mediaType: entry.mediaType,
      },
    })),
  };
}

export function buildLocalMediaSchedule(entries: LocalMediaEntry[]) {
  const channel = buildLocalMediaChannel(entries);
  return entries.length
    ? [{
        id: channel.id,
        guideId: channel.guideId,
        name: channel.name,
        mediaType: channel.mediaType,
        group: channel.group,
        programs: entries.map((entry, index) => ({
          id: entry.id,
          guideId: LOCAL_MEDIA_GUIDE_ID,
          channelId: LOCAL_MEDIA_CHANNEL_ID,
          title: entry.name,
          description: `Local file · ${entry.mimeType} · ${Math.round(entry.size / 1024 / 1024)} MB`,
          startTime: index,
          endTime: index + 1,
          startHour: index % 24,
          endHour: (index % 24) + 1,
          mediaType: entry.mediaType,
          mediaUrl: entry.objectUrl,
          archivePath: entry.objectUrl,
          metadata: {
            source: 'local-file',
            fileName: entry.name,
            directoryName: entry.directoryName,
            lastModified: entry.lastModified,
          },
        })),
      }]
    : [];
}

export function isLikelyNativePlayable(mediaType: MediaType, file: File): boolean {
  const element = document.createElement(mediaType);
  const probe = file.type || (mediaType === 'audio' ? 'audio/mpeg' : 'video/mp4');
  return element.canPlayType(probe) !== '';
}
