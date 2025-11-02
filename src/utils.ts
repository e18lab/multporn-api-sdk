export function toAbsolute(baseURL: string, href?: string): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href).toString();
  } catch {
    if (href.startsWith('//')) {
      const base = new URL(baseURL);
      return `${base.protocol}${href}`;
    }
    return new URL(href.replace(/^\//, ''), baseURL.replace(/\/+$/, '') + '/').toString();
  }
}

export function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export function absUrl(base: string, href?: string | null): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

export function normSpace(s?: string | null): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

export function parseNumberLike(s?: string | null): number | undefined {
  if (!s) return undefined;
  const m = String(s)
    .replace(/[^\d.,]/g, '')
    .replace(',', '.');
  const n = parseFloat(m);
  return Number.isFinite(n) ? n : undefined;
}

export function parseIntLike(s?: string | null): number | undefined {
  if (!s) return undefined;
  const n = parseInt(String(s).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : undefined;
}

export function guessKindFromPath(path: string): import('./types').ViewerKind {
  const p = path.split('?')[0].split('#')[0];
  if (p.includes('/hentai_manga/') || p.includes('/munga/')) return 'manga';
  if (p.includes('/comics/')) return 'comics';
  if (p.includes('/pictures/')) return 'pictures';
  if (p.includes('/humor/')) return 'humor';
  if (p.includes('/video/')) return 'video';
  if (p.includes('/games/')) return 'game';
  return 'other';
}

export function guessAlphabetSectionFromPath(path: string): string {
  const slug = String(path || '')
    .trim()
    .replace(/^\//, '')
    .split('/')[0]
    ?.toLowerCase();
  const map: Record<string, string> = {
    comics: 'alphabetical_order_comics',
    manga: 'alphabetical_order_manga',
    pictures: 'alphabetical_order_pipictures',
    porn_gifs: 'alphabetical_order_gif',
    characters: 'alphabetical_order_characters',
    category_comic: 'alphabetical_order_category_comic',
    authors_comics: 'alphabetical_order_authors_comics',
    authors_hentai: 'alphabetical_order_authors_hentai',
    pipictures: 'alphabetical_order_pipictures',
  };
  return map[slug] || (slug ? `alphabetical_order_${slug}` : 'alphabetical_order');
}
