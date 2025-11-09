import IDOMParser from 'advanced-html-parser';
import type { DomApi, DomDocument, DomElement } from './adapter';

function toArray<T>(list: any): T[] {
  if (!list) return [];
  return Array.isArray(list) ? list : Array.from(list);
}

export function createAHPDom(): DomApi {
  return {
    parse(html: string): DomDocument {
      return IDOMParser.parse(html, {
        ignoreTags: ['script', 'style', 'head'],
        onlyBody: true,
      });
    },
    qsa(ctx: DomDocument | DomElement, selector: string): DomElement[] {
      if (!ctx) return [];
      const root = (ctx as any).documentElement ? (ctx as any).documentElement : ctx;
      return toArray(root.querySelectorAll?.(selector));
    },
    qs(ctx: DomDocument | DomElement, selector: string): DomElement | null {
      if (!ctx) return null;
      const root = (ctx as any).documentElement ? (ctx as any).documentElement : ctx;
      return root.querySelector?.(selector) ?? null;
    },
    text(el?: DomElement | null): string {
      if (!el) return '';
      let t = '';
      try {
        t = (el as any).text?.() ?? (el as any).textContent ?? '';
      } catch {}
      return String(t).replace(/\s+/g, ' ').trim();
    },
    attr(el: DomElement | null | undefined, name: string): string | undefined {
      if (!el) return undefined;
      try { return (el as any).getAttribute?.(name) ?? undefined; } catch { return undefined; }
    },
    closest(el: DomElement | null | undefined, selector: string): DomElement | null {
      if (!el) return null;
      try { return (el as any).closest?.(selector) ?? null; } catch { return null; }
    },
  };
}
