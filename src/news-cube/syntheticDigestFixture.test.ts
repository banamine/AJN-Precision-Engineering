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
  const items = Array.from({ length: count }, (_, index) => {
    const headline = version ? `Synthetic update ${version}: ${headlines[index % headlines.length]}` : headlines[index % headlines.length];
    const feedName = feeds[index % feeds.length];
    const excerpt = index === 0
      ? `<a href="https://news.google.com/rss/articles/synthetic-long-token">${headline}</a>&nbsp;<font>${feedName}</font>`
      : index === 1
        ? `Synthetic test summary ${index + 1}; no real article text. It appeared first on <a href="https://publisher.invalid/">${feedName}</a>`
        : index === 2
          ? 'Synthetic summary before truncated markup <a href="https://news.google.com/rss/articles/cut-off'
          : index === 3
            ? 'Synthetic &amp; harmless&nbsp;entity &#8217;case'
            : `Synthetic test summary ${index + 1}; no real article text.`;
    return {
      id: `synthetic-${version}-${index + 1}`,
      headline,
      title: headlines[index % headlines.length],
      url: `https://publisher.invalid/synthetic/${version}/${index + 1}`,
      excerpt,
      published: new Date(now - (index + 1) * 3_600_000).toUTCString(),
      feedName,
      feedId: `synthetic-feed-${index % feeds.length}`,
      category: index % 2 ? 'Alternative' : 'Global',
      imageUrl: index === 0 ? 'https://images.unsplash.com/synthetic-stock-image' : null,
    };
  });
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
