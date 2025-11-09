export type DomDocument = any;
export type DomElement = any;

export interface DomApi {
  parse(html: string): DomDocument;
  qsa(ctx: DomDocument | DomElement, selector: string): DomElement[];
  qs(ctx: DomDocument | DomElement, selector: string): DomElement | null;
  text(el?: DomElement | null): string;
  attr(el: DomElement | null | undefined, name: string): string | undefined;
  closest(el: DomElement | null | undefined, selector: string): DomElement | null;
}
