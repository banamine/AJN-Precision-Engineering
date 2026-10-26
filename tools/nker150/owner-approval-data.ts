import fs from 'node:fs';
import path from 'node:path';
import { classifyNker150Rights, shouldExposeNker150Record } from '../../server/nker150Rights';

export interface NkerCatalogFile {
  filename: string;
  path: string;
  format: string | null;
  fileSizeBytes: number | null;
  durationSeconds: number | null;
  isPrivate: boolean;
}

export interface NkerCatalogItem {
  id: string;
  identifier: string;
  title: string;
  originalCreator: string | null;
  date: string | null;
  itemSizeBytes: number | null;
  licenseUrl: string | null;
  rightsStatus: 'LISTED' | 'UNKNOWN';
  rightsReview: string;
  archiveDetailsUrl: string;
  showId: string;
  showLabel: string;
  unclassified: boolean;
  technicalStatus: string;
  reason: string;
  file: NkerCatalogFile | null;
}

export interface NkerCatalog {
  schemaVersion: number;
  generatedFrom: string;
  items: NkerCatalogItem[];
}

export type ProxyEvidenceStatus =
  | 'PROXY_VERIFIED'
  | 'PLAYABLE_VERIFIED'
  | 'FAILED'
  | 'RESTRICTED'
  | 'NO_SUPPORTED_VIDEO';

export interface ProxyEvidenceItem {
  identifier: string;
  status: ProxyEvidenceStatus;
  auditedAt: string;
  httpStatus: number | null;
  contentType?: string | null;
  contentRange?: string | null;
  attempts?: number;
  reason?: string;
  failureBoundary?: string;
}

export interface ProxyEvidence {
  schemaVersion: 1;
  items: ProxyEvidenceItem[];
}

const root = path.resolve('tools/nker150');
const catalogPath = path.join(root, 'nker150_catalog.json');
const evidencePath = path.join(root, 'proxy-evidence.json');
const manifestPath = path.resolve('src/data/nker150Manifest.json');

function atomicJson(filePath: string, value: unknown): void {
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporaryPath, filePath);
}

export function readNkerCatalog(): NkerCatalog {
  return JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as NkerCatalog;
}

export function readProxyEvidence(): ProxyEvidence {
  if (!fs.existsSync(evidencePath)) return { schemaVersion: 1, items: [] };
  const parsed = JSON.parse(fs.readFileSync(evidencePath, 'utf8')) as ProxyEvidence;
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.items)) throw new Error('Invalid tools/nker150/proxy-evidence.json');
  return parsed;
}

export function saveProxyEvidence(evidence: ProxyEvidence): void {
  atomicJson(evidencePath, evidence);
}

export function writeNker150Projections(catalog: NkerCatalog, evidence: ProxyEvidence): void {
  const evidenceById = new Map(evidence.items.map((item) => [item.identifier, item]));
  for (const item of catalog.items) {
    const result = evidenceById.get(item.identifier);
    if (item.technicalStatus === 'RESTRICTED' || item.file?.isPrivate) {
      item.technicalStatus = 'RESTRICTED';
      item.reason = 'Archive metadata marks the item or selected file restricted';
    } else if (result?.status === 'PROXY_VERIFIED') {
      item.technicalStatus = 'PROXY_VERIFIED';
      item.reason = result.reason ?? 'bounded Archive proxy range verified; browser playback not yet confirmed';
    } else if (result?.status === 'PLAYABLE_VERIFIED') {
      item.technicalStatus = 'VERIFIED';
      item.reason = result.reason ?? 'real-browser playback evidence recorded';
    } else if (result?.status === 'FAILED') {
      item.technicalStatus = 'FAILED';
      item.reason = result.reason ?? `verification failed with HTTP ${result.httpStatus ?? 'no response'}`;
    } else if (result?.status === 'NO_SUPPORTED_VIDEO') {
      item.technicalStatus = 'PENDING_REVIEW';
      item.reason = result.reason ?? 'no selected browser-safe MPEG4 or H.264 video file';
    }
    item.rightsReview = classifyNker150Rights(item.licenseUrl, item.identifier);
  }

  const previousManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    items: Array<{ identifier: string; indexedAt?: string }>;
  };
  const indexedAtById = new Map(previousManifest.items.map((item) => [item.identifier, item.indexedAt]));
  const manifestItems = catalog.items.flatMap((item) => {
    if (!item.file || item.file.isPrivate) return [];
    const technicalStatus = item.technicalStatus === 'VERIFIED' ? 'PLAYABLE_VERIFIED' : item.technicalStatus;
    if (!shouldExposeNker150Record({
      technicalStatus,
      rightsReview: item.rightsReview,
      isPrivate: item.file.isPrivate,
    })) return [];
    const proxyEvidence = evidenceById.get(item.identifier);
    const isPlayable = technicalStatus === 'PLAYABLE_VERIFIED';
    const itemDate = item.date ?? '';
    return [{
      id: item.id,
      identifier: item.identifier,
      title: item.title,
      description: isPlayable
        ? 'Internet Archive source item; playback status verified in the AJN player.'
        : 'Internet Archive source item; bounded proxy range verified, full playback not yet checked.',
      categoryIds: ['nker150-special'],
      mediaType: 'video',
      ...( /^\d{4}/.test(itemDate) ? {
        year: Number(itemDate.slice(0, 4)),
        decade: Math.floor(Number(itemDate.slice(0, 4)) / 10) * 10,
      } : {}),
      path: item.file.path,
      file: item.file.filename,
      format: item.file.format ?? 'unknown',
      dur: Math.round(item.file.durationSeconds ?? 0),
      durSrc: 'metadata',
      durEst: item.file.durationSeconds === null,
      availability: 'verified',
      foundBy: 'nker150 cached metadata',
      why: isPlayable ? 'real-browser playback verified' : 'bounded Archive proxy range verified; browser playback pending',
      indexedAt: isPlayable
        ? indexedAtById.get(item.identifier) ?? proxyEvidence?.auditedAt.slice(0, 10)
        : proxyEvidence?.auditedAt.slice(0, 10),
      originalCreator: item.originalCreator,
      itemSizeBytes: item.itemSizeBytes,
      fileSizeBytes: item.file.fileSizeBytes,
      licenseUrl: item.licenseUrl,
      rightsStatus: item.rightsStatus,
      rightsReview: item.rightsReview,
      archiveDetailsUrl: item.archiveDetailsUrl,
      showId: item.showId,
      showLabel: item.showLabel,
      technicalStatus,
    }];
  });

  atomicJson(catalogPath, catalog);
  atomicJson(manifestPath, { schemaVersion: 1, items: manifestItems });
}
