import ownerApprovals from '../tools/nker150/owner-approvals.json';

export type Nker150RightsReview = 'OWNER_APPROVED' | 'ALLOWLIST_PATTERN' | 'PENDING_REVIEW';

const ALLOWED_LICENSE_URL =
  /^https?:\/\/creativecommons\.org\/(?:publicdomain\/(?:zero|mark)\/1\.0|licenses\/by(?:-sa)?\/(?:2\.0|2\.5|3\.0|4\.0))(?:\/|$)/i;
const OWNER_APPROVED_IDENTIFIERS = new Set(ownerApprovals.approvals.map((approval) => approval.identifier));

/** Owner approval is identifier-specific; all other records use this conservative URL-pattern gate. */
export function classifyNker150Rights(
  licenseUrl: string | null | undefined,
  identifier?: string,
): Nker150RightsReview {
  if (identifier && OWNER_APPROVED_IDENTIFIERS.has(identifier)) return 'OWNER_APPROVED';
  const value = String(licenseUrl ?? '').trim();
  return value && ALLOWED_LICENSE_URL.test(value) ? 'ALLOWLIST_PATTERN' : 'PENDING_REVIEW';
}

/** Pending or unknown rights stay out of the ordinary library; audit mode must not be enabled in deploy config. */
export function shouldExposeNker150Record(
  record: { technicalStatus?: string; rightsReview?: string; isPrivate?: boolean },
  auditMode = false,
): boolean {
  if (record.isPrivate || record.technicalStatus === 'RESTRICTED' || record.technicalStatus === 'FAILED') return false;
  if (record.technicalStatus !== 'PLAYABLE_VERIFIED' && record.technicalStatus !== 'PROXY_VERIFIED') return false;
  return auditMode || record.rightsReview === 'OWNER_APPROVED' || record.rightsReview === 'ALLOWLIST_PATTERN';
}
