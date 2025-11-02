export interface ParsedVideo {
  poster?: string;
  sources: Array<{ url: string; type?: string; label?: string }>;
}

const ABS_URL = /^https?:\/\//i;

function absolutize(u: string, base: string) {
  if (!u) return '';
  if (ABS_URL.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return base.replace(/\/+$/, '') + u;
  return u;
}

export function parseVideoFromHtml(html: string, baseURL: string): ParsedVideo | null {
  if (!html || !/node-video|class=["']video-js|<video/i.test(html)) return null;

  const posterMatch =
    html.match(/<video[^>]*\sposter=["']([^"']+)["']/i) ||
    html.match(/class=["']video-js[^"']*["'][^>]*\sposter=["']([^"']+)["']/i);

  const poster = posterMatch ? absolutize(posterMatch[1], baseURL) : undefined;

  const sources: Array<{ url: string; type?: string; label?: string }> = [];

  const mainVideo = html.match(/<video[^>]*\ssrc=["']([^"']+)["'][^>]*>/i);
  if (mainVideo) sources.push({ url: absolutize(mainVideo[1], baseURL) });

  const re = /<source[^>]*\ssrc=["']([^"']+)["'][^>]*?(?:\stype=["']([^"']+)["'])?[^>]*>/gi;
  for (let m: RegExpExecArray | null; (m = re.exec(html)); ) {
    sources.push({ url: absolutize(m[1], baseURL), type: m[2] });
  }

  if (!sources.length) return null;

  return { poster, sources };
}
