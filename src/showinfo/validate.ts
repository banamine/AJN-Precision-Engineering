import type { ShowInfo, ShowInfoFile } from './types';

const IMDB_URL_PATTERN = /^https:\/\/www\.imdb\.com\/title\/tt\d{7,9}\/$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string';
}

function isNonEmptyText(value: unknown): value is string {
  return isText(value) && value.trim().length > 0;
}

function isNullableText(value: unknown): value is string | null {
  return value === null || isText(value);
}

function isNullableYear(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value));
}

function isDateText(value: unknown): value is string {
  return isText(value) && Number.isFinite(Date.parse(value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isText);
}

function isTvmazeUrl(value: unknown): value is string {
  if (!isText(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'www.tvmaze.com'
      && url.username === ''
      && url.password === ''
      && url.pathname.startsWith('/shows/');
  } catch {
    return false;
  }
}

function isValidCast(value: unknown): value is ShowInfo['cast'] {
  return Array.isArray(value)
    && value.length <= 6
    && value.every((member) => isRecord(member)
      && isText(member.name)
      && isText(member.role));
}

function validateShow(value: unknown, index: number, errors: string[]): value is ShowInfo {
  const path = `shows[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }

  let valid = true;
  const reject = (message: string) => {
    errors.push(`${path}.${message}`);
    valid = false;
  };

  if (!isNonEmptyText(value.id)) reject('id must be a non-empty string');
  if (!isNonEmptyText(value.title)) reject('title must be a non-empty string');

  if (!isRecord(value.years)
    || !isNullableYear(value.years.start)
    || !isNullableYear(value.years.end)) {
    reject('years must contain nullable integer start and end values');
  }

  if (!isStringArray(value.genres) || value.genres.length > 3) {
    reject('genres must be a string array with at most 3 entries');
  }
  if (!isText(value.overview) || value.overview.length > 140) {
    reject('overview must be a string of at most 140 characters');
  }
  if (!isText(value.blurb) || value.blurb.length > 90) {
    reject('blurb must be a string of at most 90 characters');
  }
  if (!isValidCast(value.cast)) {
    reject('cast must contain at most 6 name and role records');
  }

  if (!isRecord(value.details)) {
    reject('details must be an object');
  } else {
    if (!isNullableText(value.details.network)) reject('details.network must be a string or null');
    if (!['ended', 'running', 'unknown'].includes(String(value.details.status))) {
      reject('details.status is invalid');
    }
    if (!isText(value.details.note) || value.details.note.length > 400) {
      reject('details.note must be a string of at most 400 characters');
    }
  }

  if (!isRecord(value.source)) {
    reject('source must be an object');
  } else {
    if (value.source.name !== 'TVmaze') reject('source.name must be TVmaze');
    if (!isTvmazeUrl(value.source.url)) reject('source.url must be an HTTPS TVmaze show URL');
    if (typeof value.source.id !== 'number' || !Number.isInteger(value.source.id)) {
      reject('source.id must be an integer');
    }
    if (!isNullableText(value.source.imdbId)) reject('source.imdbId must be a string or null');
    if (!isDateText(value.source.fetchedAt)) reject('source.fetchedAt must be a date string');
  }

  if (!isRecord(value.links)) {
    reject('links must be an object');
  } else {
    if (!isStringArray(value.links.channelIds)) reject('links.channelIds must be a string array');
    if (!isStringArray(value.links.archiveIdentifiers)) {
      reject('links.archiveIdentifiers must be a string array');
    }
    if (value.links.imdbUrl !== null
      && (!isText(value.links.imdbUrl) || !IMDB_URL_PATTERN.test(value.links.imdbUrl))) {
      reject('links.imdbUrl must be null or a valid IMDb title URL');
    }
  }

  if (!isText(value.match)) reject('match must be a string');
  if (!isText(value.corroboratedBy)) reject('corroboratedBy must be a string');
  if (value.status !== 'verified') reject('status must be verified');
  return valid;
}

export function getShowInfoErrors(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ['file must be an object'];

  if (value.schema !== 'ajn.showInfo.v1') errors.push('schema must be ajn.showInfo.v1');
  if (!isDateText(value.generatedAt)) errors.push('generatedAt must be a date string');
  if (!isText(value.source)) errors.push('source must be a string');
  if (!isText(value.note) || value.note.length > 400) {
    errors.push('note must be a string of at most 400 characters');
  }
  if (!Array.isArray(value.shows)) {
    errors.push('shows must be an array');
    return errors;
  }
  if (typeof value.count !== 'number'
    || !Number.isInteger(value.count)
    || value.count !== value.shows.length) {
    errors.push('count must equal the number of shows');
  }

  const ids = new Set<string>();
  value.shows.forEach((show, index) => {
    if (validateShow(show, index, errors) && ids.has(show.id)) {
      errors.push(`duplicate show id: ${show.id}`);
    }
    if (isRecord(show) && isNonEmptyText(show.id)) ids.add(show.id);
  });
  return errors;
}

export function validateShowInfoFile(value: unknown): ShowInfoFile | null {
  try {
    return getShowInfoErrors(value).length === 0 ? value as ShowInfoFile : null;
  } catch {
    return null;
  }
}
