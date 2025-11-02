import {
  absUrl,
  normSpace,
  parseIntLike,
  parseNumberLike,
  toAbsolute,
  uniq,
  guessKindFromPath,
} from '../utils';
import type { LinkItem, ViewerImage, ViewerKind, ViewerMeta } from '../types';

function decodeHtml(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function textBetween(html: string, openRe: RegExp, close: string): string | null {
  const m = openRe.exec(html);
  if (!m) return null;
  const i = m.index + m[0].length;
  const j = html.indexOf(close, i);
  if (j < 0) return null;
  return html.slice(i, j);
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}

function collectLinks(blockHtml: string, baseURL: string): LinkItem[] {
  const out: LinkItem[] = [];
  const re = /<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(blockHtml))) {
    const url = absUrl(baseURL, m[1]) ?? '';
    const title = normSpace(decodeHtml(stripTags(m[2])));
    if (url && title) out.push({ url, title });
  }
  return out;
}

function findFieldNodeAndSys(html: string): { nodeId: number; fieldSys: string } | null {
  const re = /id="field--node--(\d+)--([a-z0-9_-]+)--full"/i;
  const m = re.exec(html);
  if (m) {
    const nodeId = parseInt(m[1], 10);
    const fieldSys = m[2].replace(/-/g, '_');
    if (Number.isFinite(nodeId)) return { nodeId, fieldSys };
  }

  const re2 = /\/juicebox\/xml\/field\/node\/(\d+)\/([a-z0-9_]+)\/full/gi;
  const m2 = re2.exec(html);
  if (m2) {
    const nodeId = parseInt(m2[1], 10);
    const fieldSys = m2[2];
    if (Number.isFinite(nodeId)) return { nodeId, fieldSys };
  }
  return null;
}

export function buildJuiceboxXmlUrl(baseURL: string, nodeId: number, fieldSys: string): string {
  const root = baseURL.replace(/\/+$/, '');
  return `${root}/juicebox/xml/field/node/${nodeId}/${fieldSys}/full`;
}

export function parseJuiceboxXml(xml: string): ViewerImage[] {
  const images: ViewerImage[] = [];
  const reImg = /<image\b([^>]+)>/gi;
  let m: RegExpExecArray | null;
  while ((m = reImg.exec(xml))) {
    const attrs = m[1];
    const map: Record<string, string> = {};
    let am: RegExpExecArray | null;
    const reAttr = /([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"/g;
    while ((am = reAttr.exec(attrs))) map[am[1]] = am[2];

    const original =
      map['linkURL'] || map['imageURL'] || map['largeImageURL'] || map['smallImageURL'] || '';
    if (!original) continue;

    images.push({
      original,
      large: map['largeImageURL'],
      medium: map['imageURL'] || map['smallImageURL'],
      small: map['smallImageURL'],
      thumb: map['thumbURL'],
    });
  }
  return images;
}

export function parseInlineJuiceboxFromHtml(html: string): ViewerImage[] {
  const out: ViewerImage[] = [];
  const reMed = /<img[^>]+src="([^"]+\/styles\/juicebox_(?:medium|small|large)\/[^"]+)"[^>]*>/gi;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = reMed.exec(html))) {
    const url = m[1];
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ original: url, medium: url });
  }
  return out;
}

function parseBreadcrumbs(html: string, baseURL: string): LinkItem[] {
  const block = textBetween(html, /<div[^>]+class="breadcrumb"[^>]*>/i, '</div>');
  return block ? collectLinks(block, baseURL) : [];
}

function parseLabeledField(html: string, labelStartsWith: string): string | null {
  const re = new RegExp(
    `<h3[^>]*class="[^"]*field-label[^"]*"[^>]*>\\s*${labelStartsWith}\\s*:?\\s*<\\/h3>`,
    'i',
  );
  const idx = html.search(re);
  if (idx < 0) return null;
  const open = html.lastIndexOf('<div', idx);
  const close = html.indexOf('</div>', idx);
  if (open < 0 || close < 0) return null;
  return html.slice(open, close + 6);
}

function parseNumberFromText(html: string, label: string): number | undefined {
  const block = parseLabeledField(html, label);
  if (!block) return undefined;
  return parseNumberLike(block);
}

function parseTitle(html: string): string {
  const h1 = textBetween(html, /<h1[^>]*id="page-title"[^>]*>/i, '</h1>');
  if (h1) return normSpace(decodeHtml(stripTags(h1)));
  const m = /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i.exec(html);
  if (m) return normSpace(decodeHtml(m[1]));
  return '';
}

function parseVotesAndRating(html: string): { rating?: number; votes?: number } {
  const mBlock =
    /class="fivestar-summary[\s\S]*?Average:\s*<span>([\d.,]+)<\/span>[\s\S]*?\(\s*<span>(\d+)<\/span>\s*votes?\s*\)/i.exec(
      html,
    );
  if (mBlock) {
    return {
      rating: parseNumberLike(mBlock[1]),
      votes: parseIntLike(mBlock[2]),
    };
  }
  return {};
}

function parseViews(html: string): number | undefined {
  const m =
    /<li[^>]*class="statistics_counter[^"]*"[^>]*>\s*<span>\s*([\d\s.,]+)\s+views\s*<\/span>/i.exec(
      html,
    );
  return m ? parseIntLike(m[1]) : undefined;
}

function parseLinksFromLabeledField(html: string, baseURL: string, label: string): LinkItem[] {
  const block = parseLabeledField(html, label);
  return block ? collectLinks(block, baseURL) : [];
}

function parseRelated(html: string, baseURL: string): LinkItem[] {
  const pieces: string[] = [];
  const re =
    /<div[^>]+class="view[^"]*down[^"]*random[^"]*hentai[^"]*manga[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) pieces.push(m[1]);
  return uniq(pieces.flatMap((p) => collectLinks(p, baseURL)));
}

export function parseViewerMeta(
  html: string,
  baseURL: string,
  absoluteUrl: string,
): {
  meta: ViewerMeta;
  nodeId: number | null;
  fieldSys: string | null;
} {
  const title = parseTitle(html);
  const breadcrumbs = parseBreadcrumbs(html, baseURL);
  const authors = parseLinksFromLabeledField(html, baseURL, 'Author');
  const sections = parseLinksFromLabeledField(html, baseURL, 'Section');
  const tags = parseLinksFromLabeledField(html, baseURL, 'Tags');
  const { rating, votes } = parseVotesAndRating(html);
  const views = parseViews(html);

  const kind: ViewerKind = guessKindFromPath(absoluteUrl);
  const field = findFieldNodeAndSys(html);

  const meta: ViewerMeta = {
    nodeId: field?.nodeId ?? null,
    fieldSys: field?.fieldSys ?? null,
    title,
    kind,
    breadcrumbs,
    authors,
    sections,
    tags,
    rating,
    votes,
    views,
    related: parseRelated(html, baseURL),
  };

  return { meta, nodeId: meta.nodeId, fieldSys: meta.fieldSys };
}

function findCanonicalUrl(html: string, baseURL: string): string {
  const m1 = /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i.exec(html);
  if (m1?.[1]) return absUrl(baseURL, m1[1]) ?? baseURL.replace(/\/+$/, '');
  const m2 = /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i.exec(html);
  if (m2?.[1]) return absUrl(baseURL, m2[1]) ?? baseURL.replace(/\/+$/, '');
  return baseURL.replace(/\/+$/, '');
}

function collectImgSrcs(html: string): string[] {
  const out: string[] = [];
  const re = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

export function parseViewer(
  html: string,
  baseURL: string,
): { meta: ViewerMeta; images: ViewerImage[] } {
  const absoluteUrl = findCanonicalUrl(html, baseURL);

  const { meta } = parseViewerMeta(html, baseURL, absoluteUrl);

  const inline: ViewerImage[] = parseInlineJuiceboxFromHtml(html)
    .map((im): ViewerImage => {
      const original = (toAbsolute(baseURL, im.original || '') || '') as string;
      return {
        original,
        large: im.large ? toAbsolute(baseURL, im.large) || undefined : undefined,
        medium: im.medium ? toAbsolute(baseURL, im.medium) || undefined : undefined,
        small: im.small ? toAbsolute(baseURL, im.small) || undefined : undefined,
        thumb: im.thumb ? toAbsolute(baseURL, im.thumb) || undefined : undefined,
      };
    })
    .filter((im) => !!im.original);

  let fallback: ViewerImage[] = [];
  if (inline.length === 0) {
    const srcs = collectImgSrcs(html)
      .map((u) => toAbsolute(baseURL, u) || '')
      .filter((u) => !!u);
    const seen = new Set<string>();
    fallback = srcs
      .filter((u) => {
        if (!u || seen.has(u)) return false;
        seen.add(u);
        return true;
      })
      .map((u): ViewerImage => ({ original: u }));
  }

  const all: ViewerImage[] = [...inline, ...fallback];
  const byOriginal = new Map<string, ViewerImage>();
  for (const im of all) {
    const key = im.original || '';
    if (key && !byOriginal.has(key)) byOriginal.set(key, im as ViewerImage);
  }

  return { meta, images: Array.from(byOriginal.values()) };
}

export default parseViewer;
