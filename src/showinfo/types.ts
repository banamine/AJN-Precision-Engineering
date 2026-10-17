export interface ShowInfo {
  id: string;
  title: string;
  years: {
    start: number | null;
    end: number | null;
  };
  genres: string[];
  overview: string;
  blurb: string;
  cast: Array<{
    name: string;
    role: string;
  }>;
  details: {
    network: string | null;
    status: 'ended' | 'running' | 'unknown';
    note: string;
  };
  source: {
    name: 'TVmaze';
    url: string;
    id: number;
    imdbId: string | null;
    fetchedAt: string;
  };
  links: {
    channelIds: string[];
    archiveIdentifiers: string[];
    imdbUrl: string | null;
  };
  match: string;
  corroboratedBy: string;
  status: 'verified';
}

export interface ShowInfoFile {
  schema: 'ajn.showInfo.v1';
  generatedAt: string;
  source: string;
  note: string;
  count: number;
  shows: ShowInfo[];
}
