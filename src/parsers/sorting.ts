import { toAbsolute } from '../utils';
import type { ExposedOption, ExposedSelect, SortingUI } from '../types';

export function parseExposedSorting(html: string, baseURL: string): SortingUI | undefined {
  const vfIdx = html.search(/<div[^>]+class=["'][^"']*view-filters[^"']*["'][^>]*>/i);
  if (vfIdx < 0) return undefined;

  // Найдём форму внутри блока view-filters
  const formStart = html.indexOf('<form', vfIdx);
  if (formStart < 0) return undefined;
  const formEnd = html.indexOf('</form>', formStart);
  if (formEnd < 0) return undefined;
  const formHtml = html.slice(formStart, formEnd + 7);

  const actionMatch = /<form[^>]*\baction=["']([^"']+)["'][^>]*>/i.exec(formHtml);
  if (!actionMatch) return undefined;

  const abs = toAbsolute(baseURL, actionMatch[1] || '');
  if (!abs) return undefined;

  let actionPath = '/';
  try {
    actionPath = new URL(abs).pathname || '/';
  } catch {
    actionPath = '/';
  }

  const labels = new Map<string, string>();
  const reLabel = /<label[^>]*\bfor=["']([^"']+)["'][^>]*>([\s\S]*?)<\/label>/gi;
  let lm: RegExpExecArray | null;
  while ((lm = reLabel.exec(formHtml))) {
    const id = lm[1];
    const raw = (lm[2] || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (id && raw) labels.set(id, raw);
  }

  const selects: ExposedSelect[] = [];
  const reSelect = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = reSelect.exec(formHtml))) {
    const attrs = sm[1] || '';
    const inner = sm[2] || '';

    const name = /(?:^|\s)name=["']([^"']+)["']/i.exec(attrs)?.[1];
    if (!name) continue;

    const idAttr = /(?:^|\s)id=["']([^"']+)["']/i.exec(attrs)?.[1];
    const label = idAttr ? labels.get(idAttr) : undefined;

    const options: ExposedOption[] = [];
    const reOpt = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
    let om: RegExpExecArray | null;
    while ((om = reOpt.exec(inner))) {
      const oattrs = om[1] || '';
      const text = (om[2] || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      const val = /(?:^|\s)value=["']([^"']*)["']/i.exec(oattrs)?.[1] ?? text;
      const selected = /\bselected\b/i.test(oattrs) || /\bselected=["']selected["']/i.test(oattrs);
      options.push({ value: val, label: text || val, selected });
    }

    selects.push({ name, label, options });
  }

  if (!selects.length) return undefined;

  const appliedParams: Record<string, string> = {};
  for (const s of selects) {
    const selected = s.options.find((o) => o.selected);
    if (selected && selected.value !== undefined) {
      appliedParams[s.name] = String(selected.value);
    }
  }

  return { actionPath, selects, appliedParams };
}
