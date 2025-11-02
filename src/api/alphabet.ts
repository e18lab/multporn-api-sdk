import { HttpClient } from '../http';
import type { AlphabetLetter, AlphabetSection, ListingItem, Page } from '../types';
import { parseAlphabetLetters, parseAlphabetListing } from '../parsers/alphabet';

type Cfg = { hubPath: string; alphaPrefix: string };

const ALPHA_CFG: Record<string, Cfg> = {
  comics: { hubPath: '/comic', alphaPrefix: '/alphabetical_order_comics' },
  category_comic: { hubPath: '/category_comic', alphaPrefix: '/category_comic/alphabetical' },
  characters: { hubPath: '/characters', alphaPrefix: '/alphabetical_order_characters' },
  authors_comics: { hubPath: '/authors_comics', alphaPrefix: '/alphabetical_order_authors' },
  pipictures: { hubPath: '/pipictures', alphaPrefix: '/alphabetical_order_pictures' },
  porn_gifs: { hubPath: '/porn_gifs', alphaPrefix: '/alphabetical_order_gif' },
  manga: { hubPath: '/munga', alphaPrefix: '/alphabetical_order_manga' },
  authors_hentai: { hubPath: '/authors_hentai', alphaPrefix: '/authors_hentai/alphabetical' },
};

export async function alphabetLetters(
  http: HttpClient,
  baseURL: string,
  section: AlphabetSection,
): Promise<AlphabetLetter[]> {
  const cfg = (ALPHA_CFG as Record<string, Cfg>)[section];
  const hub = cfg.hubPath;
  const html = await http.getHtml(hub);
  return parseAlphabetLetters(html, baseURL);
}

export async function alphabetItems(
  http: HttpClient,
  baseURL: string,
  section: AlphabetSection,
  letter: string,
  page = 0,
): Promise<Page<ListingItem>> {
  const cfg = (ALPHA_CFG as Record<string, Cfg>)[section];
  const letterSeg = encodeURIComponent(letter);
  const html = await http.getHtml(`${cfg.alphaPrefix}/${letterSeg}?page=${page}`);
  return parseAlphabetListing(html, baseURL, page);
}
