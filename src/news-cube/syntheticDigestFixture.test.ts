/** Synthetic, test-only Daily News Digest records. Never imported by the application. */
export function syntheticDigestFixture(now: number = Date.now(), version = 0, count = 8): Record<string, unknown> {
  const headlines = [
    'Synthetic test headline: city transit committee publishes a route plan',
    'Synthetic test headline: regional weather office releases a seasonal report',
    'Synthetic test headline: public library announces expanded evening hours',
    'Synthetic test headline: local science center opens a new exhibit',
    'Synthetic test headline: school board posts its monthly meeting agenda',
    'Synthetic test headline: community garden group shares planting dates',
    'Synthetic test headline: county museum schedules a history lecture',
    'Synthetic test headline: neighborhood council records a park update',
  ];
  const feeds = ['Synthetic Herald', 'Synthetic Public Radio', 'Synthetic Local Desk'];
  const items = Array.from({ length: count }, (_, index) => ({
    id: `synthetic-${version}-${index + 1}`,
    headline: version ? `Synthetic update ${version}: ${headlines[index % headlines.length]}` : headlines[index % headlines.length],
    title: headlines[index % headlines.length],
    url: `https://publisher.invalid/synthetic/${version}/${index + 1}`,
    excerpt: `Synthetic test summary ${index + 1}; no real article text.`,
    published: new Date(now - (index + 1) * 3_600_000).toUTCString(),
    feedName: feeds[index % feeds.length],
    feedId: `synthetic-feed-${index % feeds.length}`,
    category: index % 2 ? 'Alternative' : 'Global',
    imageUrl: index === 0 ? 'https://images.unsplash.com/synthetic-stock-image' : null,
  }));
  return {
    last_updated: new Date(now).toISOString(),
    date: new Date(now).toISOString().slice(0, 10),
    stories_count: Math.min(6, items.length),
    rss_articles_count: items.length,
    stories: items.slice(0, Math.min(6, items.length)),
    rss_feeds_articles: items,
    scraped_articles: [],
  };
}
