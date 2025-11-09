import { createAHPDom } from './dom/ahp';
import { MultpornClientCore } from './client-core';

export class MultpornClient extends MultpornClientCore {
  constructor(opts?: Partial<ConstructorParameters<typeof MultpornClientCore>[0]>) {
    super({ ...(opts || {}), dom: createAHPDom() } as any);
  }
}

export * from './types';
