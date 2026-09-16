import { NewsArticle } from '../types';

export const NEWS_VIEWER_FIXTURE: NewsArticle = {
  id: 'ajnsample-1',
  title: 'Sample AJN News Story — Viewer Layout Verification',
  summary:
    'This controlled fixture is used only to verify the News Viewer shell. It intentionally contains a longer summary so viewport containment, vertical scrolling, image sizing, minimization, and fullscreen behavior can be checked before the live RSS contract is connected.',
  link: 'https://example.com/news-story',
  published: 'Recently',
  feedName: 'AJN News Preview',
  category: 'News',
  author: 'AJN Editorial Preview',
  imageUrl: 'https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/b490/live/dc850210-b1b4-11f1-b1d1-571ed4d7ff2c.jpg',
};
