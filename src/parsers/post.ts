import * as cheerio from 'cheerio';
import { Post } from '../types';
import { toAbsolute, uniq } from '../utils';

export function parsePost(html: string, baseURL: string, url: string): Post {
  const $ = cheerio.load(html);

  const title =
    $('h1').first().text().trim() ||
    $('.page-title, .node-title, .title').first().text().trim() ||
    url;

  const container = $('#content, .content, article, .node, .field-items').first();

  const imgs: string[] = [];
  container.find('img').each((_, img) => {
    const el = $(img);
    const src = el.attr('data-src') || el.attr('src');
    const abs = toAbsolute(baseURL, src || '');
    if (abs) imgs.push(abs);
  });

  const images = uniq(imgs);
  const tags: string[] = [];
  $('.tags a, a[rel="tag"], .field-name-field-tags a').each((_, a) => {
    const t = $(a).text().trim();
    if (t) tags.push(t);
  });

  const author =
    $('.author a').first().text().trim() || $('.submitted .username').first().text().trim() || null;

  return { title, url, images, tags: uniq(tags), author };
}
