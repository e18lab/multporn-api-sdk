import { setTimeout as sleep } from 'timers/promises';

export type RetryPolicy = {
  retries: number;
  factor: number;
  minDelayMs: number;
  maxDelayMs: number;
  retryOn: (status?: number) => boolean;
};

export const defaultRetryPolicy: RetryPolicy = {
  retries: 2,
  factor: 2,
  minDelayMs: 300,
  maxDelayMs: 3000,
  retryOn: (status) => {
    if (status == null) return true;
    return status >= 500 && status <= 599;
  },
};

export class HttpError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export type HttpClientOptions = {
  baseURL: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retry?: Partial<RetryPolicy>;
  userAgent?: string;
};

export class HttpClient {
  private baseURL: string;
  private headers: Record<string, string>;
  private timeoutMs: number;
  private retry: RetryPolicy;
  private userAgent: string;

  constructor(opts: HttpClientOptions) {
    this.baseURL = opts.baseURL.replace(/\/+$/, '');
    this.headers = opts.headers ?? {};
    this.timeoutMs = opts.timeoutMs ?? 15000;
    this.retry = { ...defaultRetryPolicy, ...(opts.retry ?? {}) };
    this.userAgent =
      opts.userAgent ??
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118 Safari/537.36';
  }

  private buildURL(pathOrUrl: string) {
    try {
      return new URL(pathOrUrl).toString();
    } catch {
      return new URL(pathOrUrl.replace(/^\//, ''), this.baseURL + '/').toString();
    }
  }

  async getHtml(pathOrUrl: string, attempt = 0): Promise<string> {
    const url = this.buildURL(pathOrUrl);
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          ...this.headers,
        },
        signal: ctrl.signal,
      });
      clearTimeout(id as any);
      if (!res.ok) {
        if (this.retry.retryOn(res.status) && attempt < this.retry.retries) {
          const delay = Math.min(
            this.retry.maxDelayMs,
            this.retry.minDelayMs * this.retry.factor ** attempt,
          );
          await sleep(delay);
          return this.getHtml(pathOrUrl, attempt + 1);
        }
        throw new HttpError(`HTTP ${res.status}`, res.status);
      }
      return await res.text();
    } catch (e: any) {
      clearTimeout(id as any);
      if (attempt < this.retry.retries) {
        const delay = Math.min(
          this.retry.maxDelayMs,
          this.retry.minDelayMs * this.retry.factor ** attempt,
        );
        await sleep(delay);
        return this.getHtml(pathOrUrl, attempt + 1);
      }
      if (e?.name == 'AbortError') throw new HttpError('Request timeout');
      throw new HttpError(e?.message ?? 'Network error');
    }
  }

  async getJson<T = any>(pathOrUrl: string, attempt = 0): Promise<T> {
    const url = this.buildURL(pathOrUrl);
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
          ...this.headers,
        },
        signal: ctrl.signal,
      });
      clearTimeout(id as any);
      if (!res.ok) {
        if (this.retry.retryOn(res.status) && attempt < this.retry.retries) {
          const delay = Math.min(
            this.retry.maxDelayMs,
            this.retry.minDelayMs * this.retry.factor ** attempt,
          );
          await sleep(delay);
          return this.getJson<T>(pathOrUrl, attempt + 1);
        }
        throw new HttpError(`HTTP ${res.status}`, res.status);
      }
      return (await res.json()) as T;
    } catch (e: any) {
      clearTimeout(id as any);
      if (attempt < this.retry.retries) {
        const delay = Math.min(
          this.retry.maxDelayMs,
          this.retry.minDelayMs * this.retry.factor ** attempt,
        );
        await sleep(delay);
        return this.getJson<T>(pathOrUrl, attempt + 1);
      }
      if (e?.name == 'AbortError') throw new HttpError('Request timeout');
      throw new HttpError(e?.message ?? 'Network error');
    }
  }

  async postForm<T = any>(
    pathOrUrl: string,
    form: Record<string, string | string[]>,
    attempt = 0,
  ): Promise<T> {
    const url = this.buildURL(pathOrUrl);
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), this.timeoutMs);

    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) {
      if (Array.isArray(v)) {
        for (const item of v) usp.append(k, item);
      } else if (v != null) {
        usp.append(k, v);
      }
    }
    const body = usp.toString();

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'User-Agent': this.userAgent,
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json, text/javascript, */*; q=0.01',
          ...this.headers,
        },
        body,
        signal: ctrl.signal,
      });
      clearTimeout(id as any);
      if (!res.ok) {
        if (this.retry.retryOn(res.status) && attempt < this.retry.retries) {
          const delay = Math.min(
            this.retry.maxDelayMs,
            this.retry.minDelayMs * this.retry.factor ** attempt,
          );
          await sleep(delay);
          return this.postForm<T>(pathOrUrl, form, attempt + 1);
        }
        throw new HttpError(`HTTP ${res.status}`, res.status);
      }
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json') || ct.includes('text/javascript')) {
        return (await res.json()) as T;
      }
      const text = await res.text();
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as unknown as T;
      }
    } catch (e: any) {
      clearTimeout(id as any);
      if (attempt < this.retry.retries) {
        const delay = Math.min(
          this.retry.maxDelayMs,
          this.retry.minDelayMs * this.retry.factor ** attempt,
        );
        await sleep(delay);
        return this.postForm<T>(pathOrUrl, form, attempt + 1);
      }
      if (e?.name == 'AbortError') throw new HttpError('Request timeout');
      throw new HttpError(e?.message ?? 'Network error');
    }
  }
}
