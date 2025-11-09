import { createCheerioDom } from './dom/cheerio';
import { MultpornClientCore } from './client-core';

export class MultpornClient extends MultpornClientCore {
  constructor(opts?: Partial<ConstructorParameters<typeof MultpornClientCore>[0]>) {
    super({ ...(opts || {}), dom: createCheerioDom() } as any);
  }
}

export * from './types';
export * from './http';
