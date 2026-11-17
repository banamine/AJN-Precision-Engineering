import type { WeatherPlace } from './weather';

/* One-tap places for the Weather page. A state button opens that state's best-known city (named on the page after the tap). */
export interface QuickPick { label: string; place: WeatherPlace }
const US = 'United States'; const CA = 'Canada';
const p = (label: string, name: string, region: string, country: string, latitude: number, longitude: number): QuickPick => ({ label, place: { name, region, country, latitude, longitude } });
export const QUICK_PICKS: readonly QuickPick[] = [
  p('Vancouver', 'Vancouver', 'British Columbia', CA, 49.2827, -123.1207),
  p('Victoria', 'Victoria', 'British Columbia', CA, 48.4284, -123.3656),
  p('Seattle', 'Seattle', 'Washington', US, 47.6062, -122.3321),
  p('California', 'Los Angeles', 'California', US, 34.0522, -118.2437),
  p('New York', 'New York', 'New York', US, 40.7128, -74.006),
  p('Florida', 'Miami', 'Florida', US, 25.7617, -80.1918),
  p('Texas', 'Dallas', 'Texas', US, 32.7767, -96.797),
  p('Chicago', 'Chicago', 'Illinois', US, 41.8781, -87.6298),
  p('Detroit', 'Detroit', 'Michigan', US, 42.3314, -83.0458),
  p('Kentucky', 'Louisville', 'Kentucky', US, 38.2527, -85.7585),
  p('Mississippi', 'Jackson', 'Mississippi', US, 32.2988, -90.1848),
  p('Washington', 'Washington', 'District of Columbia', US, 38.9072, -77.0369),
];
