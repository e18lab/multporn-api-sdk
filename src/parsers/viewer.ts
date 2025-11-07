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

function findLabeledFieldBlock(html: string, labelStartsWith: string): string | null {
  const esc = labelStartsWith.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `<(?:h3|div)[^>]*class="[^"]*field-label[^"]*"[^>]*>\\s*${esc}\\s*:?\\s*<\\/[^>]+>`,
    'i',
  );
  const idx = html.search(re);
  if (idx < 0) return null;

  const open = html.lastIndexOf('<div', idx);
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    if (html.startsWith('<div', i)) depth++;
    if (html.startsWith('</div>', i)) {
      depth--;
      if (depth === 0) {
        return html.slice(open, i + 6);
      }
    }
  }
  return null;
}

function parseLabeledField(html: string, labelStartsWith: string): string | null {
  return findLabeledFieldBlock(html, labelStartsWith);
}

function parsePlainValuesFromLabeledField(html: string, label: string): string[] {
  const block = findLabeledFieldBlock(html, label);
  if (!block) return [];
  const text = normSpace(decodeHtml(stripTags(block)))
    .replace(new RegExp(`^${label}\\s*:?\\s*`, 'i'), '')
    .trim();
  if (!text) return [];
  return text.split(/\s*[,;]\s*/).filter(Boolean);
}

function parseTitle(html: string): string {
  const h1 = textBetween(html, /<h1[^>]*id="page-title"[^>]*>/i, '</h1>');
  if (h1) return normSpace(decodeHtml(stripTags(h1)));
  const m = /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i.exec(html);
  if (m) return normSpace(decodeHtml(m[1]));
  return '';
}

function parseVotesAndRating(html: string): { rating?: number; votes?: number } {
  const block =
    /<div[^>]*class="[^"]*\bfivestar-summary\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1] ||
    /<div[^>]*class="[^"]*\bfivestar-average[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1] ||
    '';

  if (block) {
    const mAvg =
      /class="average-rating"[^>]*>[\s\S]*?Average[^:]*:\s*(?:<span[^>]*>)?([\d.,]+)(?:<\/span>)?/i.exec(
        block,
      );
    const mVotes =
      /class="total-votes"[^>]*>\s*\(\s*(?:<span[^>]*>)?(\d+)(?:<\/span>)?\s+votes?\s*\)/i.exec(
        block,
      );

    const rating = mAvg ? parseNumberLike(mAvg[1]) : undefined;
    const votes = mVotes ? parseIntLike(mVotes[1]) : undefined;
    if (rating != null || votes != null) return { rating, votes };
  }

  const m1 =
    /Average\s*:\s*(?:<span[^>]*>)?([\d.,]+)(?:<\/span>)?[\s\S]*?\(\s*(?:<span[^>]*>)?(\d+)(?:<\/span>)?\s*votes?\s*\)/i.exec(
      html,
    );
  if (m1) {
    return {
      rating: parseNumberLike(m1[1]),
      votes: parseIntLike(m1[2]),
    };
  }

  const m2 = /Average[^<>\d]*([\d.,]+)/i.exec(html);
  const m3 = /\((\d+)\s+votes?\)/i.exec(html);
  if (m2 || m3) {
    const rating = m2 ? parseNumberLike(m2[1]) : undefined;
    const votes = m3 ? parseIntLike(m3[1]) : undefined;
    return { rating, votes };
  }

  return {};
}

function parseViews(html: string): number | undefined {
  const patterns: RegExp[] = [
    /<li[^>]*class="statistics_counter[^"]*"[^>]*>\s*<span>\s*([\d\s.,]+)\s+views\s*<\/span>/i,
    />\s*([\d\s.,]+)\s+views\s*<\/(?:span|div|li|h\d)>/i,
    />\s*Views\s*[:\-]?\s*<\/?(?:span|strong|b)?[^>]*>\s*([\d\s.,]+)\s*</i,
    /\bViews\s*[:\-]?\s*([\d\s.,]+)/i,
  ];
  for (const rx of patterns) {
    const m = rx.exec(html);
    if (m && m[1]) return parseIntLike(m[1]);
  }
  return undefined;
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

function parseUploader(
  html: string,
  baseURL: string,
):
  | {
      name?: string;
      url?: string;
      avatar?: string;
      dateText?: string;
    }
  | undefined {
  const m = /<footer[^>]*class="[^"]*\bsubmitted\b[^"]*"[^>]*>([\s\S]*?)<\/footer>/i.exec(html);
  if (!m) return undefined;
  const block = m[1];

  const a = /Uploaded\s+by\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*on\s*([^<]+)/i.exec(
    block,
  );
  const img = /<div[^>]*class="user-picture"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/i.exec(block);

  const out: { name?: string; url?: string; avatar?: string; dateText?: string } = {};
  if (a) {
    out.url = absUrl(baseURL, a[1]) ?? '';
    out.name = normSpace(decodeHtml(stripTags(a[2])));
    out.dateText = normSpace(decodeHtml(a[3]));
  }
  if (img) out.avatar = absUrl(baseURL, img[1]) ?? '';
  return out;
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

  let authors = parseLinksFromLabeledField(html, baseURL, 'Author');
  if (authors.length === 0) {
    const altLinks = parseLinksFromLabeledField(html, baseURL, "Artist's name");
    if (altLinks.length) authors = altLinks;
    if (authors.length === 0) {
      const altPlain = parsePlainValuesFromLabeledField(html, "Artist's name");
      if (altPlain.length) {
        authors = altPlain.map((t) => ({ title: t, url: '' }));
      }
    }
  }

  let sections = parseLinksFromLabeledField(html, baseURL, 'Section');
  if (sections.length === 0) {
    const sPlain = parsePlainValuesFromLabeledField(html, 'Section');
    if (sPlain.length) sections = sPlain.map((t) => ({ title: t, url: '' }));
  }

  let tags = parseLinksFromLabeledField(html, baseURL, 'Tags');
  if (tags.length === 0) {
    const block =
      /<div[^>]*class="[^"]*field-name-field-category[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
    if (block) tags = collectLinks(block[1], baseURL);
  }

  const characters = parseLinksFromLabeledField(html, baseURL, 'Characters');
  const userTags = parseLinksFromLabeledField(html, baseURL, 'User tags');
  const { rating, votes } = parseVotesAndRating(html);
  const views = parseViews(html);

  const kind: ViewerKind = guessKindFromPath(absoluteUrl);
  const field = findFieldNodeAndSys(html);
  const uploader = parseUploader(html, baseURL);

  const meta: ViewerMeta = {
    nodeId: field?.nodeId ?? null,
    fieldSys: field?.fieldSys ?? null,
    title,
    kind,
    breadcrumbs,
    authors,
    sections,
    tags,
    characters,
    userTags,
    rating,
    votes,
    views,
    related: parseRelated(html, baseURL),
  };

  if (uploader) {
    (meta as any).uploader = uploader;
  }

  return { meta, nodeId: meta.nodeId, fieldSys: meta.fieldSys };
}

function findCanonicalUrl(html: string, baseURL: string): string {
  const m1 = /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i.exec(html);
  if (m1?.[1]) return absUrl(baseURL, m1[1]) ?? baseURL.replace(/\/+$/, '');
  const m2 = /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i.exec(html);
  if (m2?.[1]) return absUrl(baseURL, m2[1]) ?? baseURL.replace(/\/+$/, '');
  return baseURL.replace(/\/+$/, '');
}

const EXCLUDE_URL_PATTERNS: RegExp[] = [
  /\/styles\/avatars\//i,
  /\/user_avatars\//i,
  /\/default_images\//i,
  /\/styles\/taxonomy_(?:comics|manga)\//i,
  /\/com_preview\//i,
  /\/promo\//i,
];

function isExcludedUrl(u: string): boolean {
  const s = String(u);
  return EXCLUDE_URL_PATTERNS.some((re) => re.test(s));
}

function stripExcludedBlocks(html: string): string {
  const patterns: RegExp[] = [
    /<div[^>]+id="comments"[^>]*>[\s\S]*?<\/div>/gi,
    /<section[^>]+id="comments"[^>]*>[\s\S]*?<\/section>/gi,
    /<div[^>]+class="[^"]*\bcomments?\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    /<div[^>]+class="[^"]*\bcomment\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    /<ul[^>]+class="[^"]*\bcomment\b[^"]*"[^>]*>[\s\S]*?<\/ul>/gi,

    /<div[^>]+class="[^"]*\brelated\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    /<div[^>]+class="[^"]*\bmore\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    /<div[^>]+class="[^"]*\bmore-comics\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    /<div[^>]+class="[^"]*\bpane-related\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi,

    /<aside[\s\S]*?<\/aside>/gi,
    /<div[^>]+class="[^"]*\bsidebar\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    /<div[^>]+class="[^"]*\bnode-footer\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi,

    /<div[^>]+class="[^"]*\bpane-views\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    /<div[^>]+class="[^"]*\bpane-taxonomy\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
  ];

  let cleaned = html;
  for (const re of patterns) cleaned = cleaned.replace(re, '');
  return cleaned;
}

function collectImgSrcs(html: string): string[] {
  const out: string[] = [];
  const re = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

function collectContentImages(html: string): string[] {
  const cleaned = stripExcludedBlocks(html);
  return collectImgSrcs(cleaned).filter((u) => !!u && !isExcludedUrl(u));
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
    const srcs = collectContentImages(html)
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
