export interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  link: string;
  published: string;
  feedName?: string;
  feedId?: string;
  category?: string;
  author?: string;
  imageUrl?: string;
}
