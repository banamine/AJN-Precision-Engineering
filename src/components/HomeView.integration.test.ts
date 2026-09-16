import assert from "node:assert/strict";
import test from "node:test";

const homeSource = `
import { AjnProgramCards } from './AjnProgramCards';
...
<section aria-labelledby="live-stations-heading">Live Station Feeds</section>
<AjnProgramCards programs={ajnRecentPrograms} />
<section aria-labelledby="portals-heading">Broadcast Destinations</section>
`;

test("HomeView keeps Live Station Feeds before the new program cards", () => {
  assert.ok(homeSource.indexOf("live-stations-heading") < homeSource.indexOf("<AjnProgramCards"));
});

test("HomeView places program cards before Broadcast Destinations", () => {
  assert.ok(homeSource.indexOf("<AjnProgramCards") < homeSource.indexOf("portals-heading"));
});

test("HomeView uses the additive AjnProgramCards component", () => {
  assert.match(homeSource, /import \{ AjnProgramCards \}/);
  assert.match(homeSource, /ajnRecentPrograms/);
  assert.match(homeSource, /AJN_FEATURED_CATEGORIES/);
});
