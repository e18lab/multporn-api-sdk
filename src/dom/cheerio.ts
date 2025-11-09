import * as cheerio from 'cheerio';
import type { DomApi, DomDocument, DomElement } from './adapter';

export function createCheerioDom(): DomApi {
  return {
    parse(html: string): DomDocument {
      return cheerio.load(html);
    },
    qsa(ctx: DomDocument | DomElement, selector: string): DomElement[] {
      const $ = typeof ctx === 'function' ? (ctx as any) : (ctx as any).$;
      const root = typeof ctx === 'function' ? (ctx as any) : (ctx as any).root || ctx;
      return ($(root) as any)(selector).toArray();
    },
    qs(ctx: DomDocument | DomElement, selector: string): DomElement | null {
      const $ = typeof ctx === 'function' ? (ctx as any) : (ctx as any).$;
      const root = typeof ctx === 'function' ? (ctx as any) : (ctx as any).root || ctx;
      const arr = ($(root) as any)(selector).toArray();
      return arr.length ? arr[0] : null;
    },
    text(el?: DomElement | null): string {
      if (!el) return '';
      try { return (cheerio as any)(el).text().trim().replace(/\s+/g, ' '); } catch { return ''; }
    },
    attr(el: DomElement | null | undefined, name: string): string | undefined {
      if (!el) return undefined;
      try { return (cheerio as any)(el).attr(name) ?? undefined; } catch { return undefined; }
    },
    closest(el: DomElement | null | undefined, selector: string): DomElement | null {
      if (!el) return null;
      try {
        const $el = (cheerio as any)(el);
        const found = $el.closest(selector).get(0);
        return found ?? null;
      } catch {
        return null;
      }
    }
  };
}
