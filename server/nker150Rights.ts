export type Nker150RightsReview = 'ALLOWLIST_PATTERN' | 'PENDING_REVIEW';

const ALLOWED_LICENSE_URL =
  /^https?:\/\/creativecommons\.org\/(?:publicdomain\/(?:zero|mark)\/1\.0|licenses\/by(?:-sa)?\/(?:2\.0|2\.5|3\.0|4\.0))(?:\/|$)/i;

/** Conservative URL-pattern gate only; this is not legal clearance. */
export function classifyNker150Rights(licenseUrl: string | null | undefined): Nker150RightsReview {
  const value = String(licenseUrl ?? '').trim();
  return value && ALLOWED_LICENSE_URL.test(value) ? 'ALLOWLIST_PATTERN' : 'PENDING_REVIEW';
}

/** Pending or unknown rights stay out of the ordinary library; audit mode must not be enabled in deploy config. */
export function shouldExposeNker150Record(
  record: { technicalStatus?: string; rightsReview?: string },
  auditMode = false,
): boolean {
  return record.technicalStatus === 'PLAYABLE_VERIFIED' &&
    (auditMode || record.rightsReview === 'ALLOWLIST_PATTERN');
}
