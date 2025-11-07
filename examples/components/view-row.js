const ABS_OR_HTTP = /^https?:\/\//i;
const BATCH = 8;

function proxifyImg(u) {
  if (!u) return '';
  if (u.startsWith('//')) return '/img?url=' + encodeURIComponent('https:' + u);
  if (ABS_OR_HTTP.test(u)) return '/img?url=' + encodeURIComponent(u);
  if (u.startsWith('/')) return '/img?url=' + encodeURIComponent('https://multporn.net' + u);
  return u;
}

class ViewRow extends HTMLElement {
  static get observedAttributes() {
    return ['view', 'title', 'link'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    this._page = 0;
    this._ended = false;
    this._loading = false;
    this._seen = new Set();

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; }
        .row {
          background: var(--card,#161b22);
          border: 1px solid var(--line,rgba(255,255,255,.08));
          border-radius: 12px;
          box-shadow: var(--shadow,0 10px 30px rgba(0,0,0,.35));
          padding: 10px 10px 12px 10px;
        }
        .hdr { display:flex; align-items:center; justify-content:space-between; padding: 4px 6px 10px; }
        .title {
          font-size:14px; font-weight:600; color:var(--fg,#e6edf3);
          text-decoration:none; outline:none;
        }
        .title:hover { color: var(--accent,#58a6ff); text-decoration: underline; }
        .btns { display:flex; gap:6px; }
        .btn {
          width:28px; height:28px; display:grid; place-items:center; color:#fff;
          background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.12);
          border-radius:8px; cursor:pointer;
        }
        .btn:hover{ background:rgba(255,255,255,.12) }

        .strip {
          display:grid;
          grid-auto-flow: column;
          grid-auto-columns: 220px;
          gap:10px;
          overflow-x:auto; overflow-y:hidden;
          scrollbar-gutter:stable;
          scroll-behavior:smooth;
          padding:2px;
        }
        .strip::-webkit-scrollbar{ height:0px }
        .strip::-webkit-scrollbar-thumb{ background:rgba(255,255,255,.15); border-radius:8px }

        .empty { color:var(--muted,#8b949e); font-size:13px; padding:6px; display:none; }
      </style>

      <div class="row">
        <div class="hdr">
          <a class="title navlink" id="ttlLink" href="#" rel="noopener"></a>
          <div class="btns">
            <button class="btn" id="prev" title="Назад" aria-label="Назад">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
            </button>
            <button class="btn" id="next" title="Вперёд" aria-label="Вперёд">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6z"/></svg>
            </button>
          </div>
        </div>

        <div class="strip" id="strip" tabindex="0" aria-label="Лента"></div>
        <div class="empty" id="empty">Нет данных</div>
      </div>
    `;

    this.$ttlLink = this.shadowRoot.getElementById('ttlLink');
    this.$strip = this.shadowRoot.getElementById('strip');
    this.$empty = this.shadowRoot.getElementById('empty');

    this.shadowRoot.getElementById('prev')?.addEventListener('click', () => this._scroll(-1));
    this.shadowRoot.getElementById('next')?.addEventListener('click', () => this._scroll(1));
    this.$strip.addEventListener('scroll', () => this._maybePrefetch());

    this.$ttlLink.addEventListener('click', (e) => {
      const href = this.$ttlLink.getAttribute('href') || '#';
      if (href === '#') e.preventDefault();
    });
  }

  get view() {
    return this.getAttribute('view') || '';
  }
  set view(v) {
    this.setAttribute('view', v || '');
  }

  get link() {
    return this.getAttribute('link') || '';
  }
  set link(v) {
    this.setAttribute('link', v || '');
  }

  attributeChangedCallback(name, _o, val) {
    if (name === 'title' && this.$ttlLink) this.$ttlLink.textContent = val || '';
    if (name === 'link' && this.$ttlLink) this.$ttlLink.setAttribute('href', val || '#');
    if (name === 'view' && this.isConnected) this._reset();
  }

  connectedCallback() {
    this._reset();
  }

  _reset() {
    this._page = 0;
    this._ended = false;
    this._loading = false;
    this._seen.clear();
    if (this.$ttlLink && !this.getAttribute('title')) this.$ttlLink.textContent = this.view;
    if (this.$ttlLink && !this.getAttribute('link')) this.$ttlLink.setAttribute('href', '#');
    this.$strip.innerHTML = '';
    this.$empty.style.display = 'none';
    this._loadMore();
  }

  _scroll(dir) {
    const step = Math.floor(this.$strip.clientWidth * 0.92) * (dir > 0 ? 1 : -1);
    this.$strip.scrollBy({ left: step, behavior: 'smooth' });
    if (dir > 0) this._maybePrefetch(true);
  }

  _maybePrefetch(force = false) {
    if (this._ended || this._loading) return;
    const nearEnd =
      this.$strip.scrollLeft + this.$strip.clientWidth >=
      this.$strip.scrollWidth - this.$strip.clientWidth * 0.8;
    if (force || nearEnd) this._loadMore();
  }

  async _loadMore() {
    if (this._loading || this._ended) return;
    this._loading = true;
    try {
      const first = this._page * BATCH + 1;
      const last = (this._page + 1) * BATCH;

      const sp = new URLSearchParams({
        view_name: this.view,
        view: this.view,
        page: String(this._page),
        first: String(first),
        last: String(last),
      });
      const r = await fetch('/api/updates?' + sp.toString(), { credentials: 'same-origin' });
      const j = await r.json();
      const data = j?.data && !Array.isArray(j.items) ? j.data : j;

      const items = Array.isArray(data?.items) ? data.items : [];
      const hasNext = typeof data?.hasNext === 'boolean' ? data.hasNext : undefined;

      if (!items.length && this._page === 0) {
        this.$empty.style.display = '';
        this._ended = true;
        return;
      }

      const frag = document.createDocumentFragment();
      for (const it of items) {
        const url = it?.url || it?.link || '';
        if (!url || this._seen.has(url)) continue;
        this._seen.add(url);

        const el = document.createElement('tile-card');
        el.setAttribute('href', '/viewer.html?url=' + encodeURIComponent(url));
        const th = it?.proxiedThumb || it?.thumb || it?.image || '';
        if (th) el.setAttribute('thumb', proxifyImg(th));
        el.setAttribute('title', String(it?.title || '').trim());
        el.setAttribute('enhance', 'auto');
        frag.appendChild(el);
      }
      this.$strip.appendChild(frag);

      items.slice(0, 6).forEach((it) => {
        const t = it?.proxiedThumb || it?.thumb || it?.image || '';
        if (!t) return;
        const l = document.createElement('link');
        l.rel = 'preload';
        l.as = 'image';
        l.href = proxifyImg(t);
        document.head.appendChild(l);
      });

      this._page++;

      if (hasNext === false) this._ended = true;
    } catch (e) {
      console.warn('[view-row]', this.view, e);
    } finally {
      this._loading = false;
    }
  }
}

if (!customElements.get('view-row')) {
  customElements.define('view-row', ViewRow);
}

export default ViewRow;
