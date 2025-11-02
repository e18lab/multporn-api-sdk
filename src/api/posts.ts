import { HttpClient } from '../http';
import { Post } from '../types';
import { parsePost } from '../parsers/post';

export async function getPost(http: HttpClient, baseURL: string, urlOrSlug: string): Promise<Post> {
  const html = await http.getHtml(urlOrSlug);
  const absolute = (() => {
    try {
      return new URL(urlOrSlug).toString();
    } catch {
      return new URL(urlOrSlug.replace(/^\//, ''), baseURL + '/').toString();
    }
  })();
  return parsePost(html, baseURL, absolute);
}
