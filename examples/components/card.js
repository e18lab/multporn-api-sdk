const ICONS = {
  calendar:
    'M7 2v2H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zm12 7H5v8h14V9z',
  chat: 'M20 2H4a2 2 0 0 0-2 2v14l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z',
};

const pathOf = (u) => {
  try {
    return new URL(u, location.origin).pathname || '/';
  } catch {
    return String(u || '/');
  }
};
const hubHref = (uOrPath) => {
  const p = (uOrPath || '').startsWith('/') ? uOrPath : pathOf(uOrPath || '/');
  return `/hub?path=${p}`;
};
const viewerHref = (uOrPath) => {
  const p = (uOrPath || '').startsWith('/') ? uOrPath : pathOf(uOrPath || '/');
  return `/viewer?path=${p}`;
};

const svg = (d, s = 16) =>
  `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
function parseTagsAttr(val) {
  if (!val) return [];
  try {
    const a = JSON.parse(val);
    if (Array.isArray(a)) return a.map(String);
  } catch {}
  return String(val)
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
function flagFrom(val) {
  if (!val) return '';
  if (/\p{Extended_Pictographic}/u.test(val)) return val;
  const s = String(val).trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(s)) {
    const A = 0x1f1e6;
    return (
      String.fromCodePoint(A + (s.charCodeAt(0) - 65)) +
      String.fromCodePoint(A + (s.charCodeAt(1) - 65))
    );
  }
  return val;
}

class TileCard extends HTMLElement {
  static get observedAttributes() {
    return [
      'href',
      'thumb',
      'title',
      'date',
      'comments',
      'badge',
      'flag',
      'tags',
      'enhance',
      'source',
    ];
  }
  #enhanced = false;
  #io = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host{ --bg:#0e1117; --fg:#e6edf3; --muted:#9aa4b2; --card:#161b22; --accent:#58a6ff; --border:rgba(255,255,255,.08); display:block;}
        .card{ background:var(--card); border:1px solid var(--border); border-radius:16px; overflow:hidden;
               box-shadow:0 6px 20px rgba(0,0,0,.25); transition:transform .18s, box-shadow .18s, border-color .18s;}
        .card:hover{ transform:translateY(-2px); box-shadow:0 10px 28px rgba(0,0,0,.32); border-color:rgba(88,166,255,.35);}
        .link{display:block;color:inherit;text-decoration:none;}
        .cover{ position:relative; aspect-ratio:3/4; background:#0b0f15; }
        .thumb{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
        .fade{ position:absolute; inset:auto 0 0 0; height:46%; background:linear-gradient(to top, rgba(0,0,0,.7), rgba(0,0,0,0)); }
        .badge{ position:absolute; left:10px; top:10px; background:#ff4d4f; color:#fff; font-weight:700; font-size:11px; padding:4px 8px; border-radius:8px; letter-spacing:.3px; box-shadow:0 4px 10px rgba(0,0,0,.3); }
        .flag{ position:absolute; left:10px; top:10px; font-size:16px; filter:drop-shadow(0 1px 2px rgba(0,0,0,.4)); }
        .actions{ position:absolute; right:10px; top:10px; display:flex; gap:8px; }
        .icon-btn{ width:28px; height:28px; display:grid; place-items:center; border-radius:50%;
                   color:#fff; background:rgba(0,0,0,.45); border:1px solid rgba(255,255,255,.15);
                   cursor:pointer; transition:background .15s, transform .15s;}
        .icon-btn:hover{ background:rgba(0,0,0,.65); transform:scale(1.05);}
        .icon-like[aria-pressed="true"]{ background:#e1556e; }
        .body{ padding:12px; display:grid; gap:8px; }
        .title{ font-size:15px; font-weight:600; line-height:1.25; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
        .meta{ display:flex; gap:12px; align-items:center; color:var(--muted); font-size:13px; }
        .meta span{ display:inline-flex; gap:6px; align-items:center; white-space:nowrap;}
        .chips{ display:flex; gap:6px; flex-wrap:wrap; }
        .chip{ background:#21262d; border:1px solid var(--border); color:var(--fg); font-size:12px; padding:4px 8px; border-radius:999px; line-height:1; user-select:none; }
        .chip.more{ color:var(--muted); }
        .hidden{ display:none !important; }
      </style>
      <a class="link" part="link">
        <article class="card" part="card">
          <div class="cover">
            <img class="thumb" part="thumb" alt="">
            <div class="fade"></div>
            <div class="flag hidden" part="flag"></div>
            <div class="badge hidden" part="badge"></div>
          </div>
          <div class="body">
            <div class="title" part="title"></div>
            <div class="meta" part="meta">
              <span class="meta-date hidden">${svg(ICONS.calendar, 16)}<i></i></span>
              <span class="meta-comments hidden">${svg(ICONS.chat, 16)}<i></i></span>
            </div>
            <div class="chips" part="chips"></div>
          </div>
        </article>
      </a>
    `;
    this.$a = this.shadowRoot.querySelector('.link');
    this.$img = this.shadowRoot.querySelector('.thumb');
    this.$title = this.shadowRoot.querySelector('.title');
    this.$badge = this.shadowRoot.querySelector('.badge');
    this.$flag = this.shadowRoot.querySelector('.flag');
    this.$metaDate = this.shadowRoot.querySelector('.meta-date');
    this.$metaDateI = this.$metaDate?.querySelector('i');
    this.$metaComments = this.shadowRoot.querySelector('.meta-comments');
    this.$metaCommentsI = this.$metaComments?.querySelector('i');
    this.$chips = this.shadowRoot.querySelector('.chips');
    this.$like = this.shadowRoot.querySelector('.icon-like');

    this.shadowRoot.addEventListener('click', (e) => {
      const a = e.composedPath().find((el) => el?.tagName === 'A');
      if (!a || !a.href) return;
      try {
        const u = new URL(a.href, location.href);
        if (u.origin === location.origin) {
          window.dispatchEvent(new CustomEvent('app-nav-start', { detail: { href: u.href } }));
        }
      } catch {}
    });
    this.$like?.addEventListener('click', (e) => {
      e.preventDefault();
      this.$like.setAttribute(
        'aria-pressed',
        this.$like.getAttribute('aria-pressed') === 'true' ? 'false' : 'true',
      );
    });
  }

  connectedCallback() {
    this.#render();
    this.#observe();
  }
  disconnectedCallback() {
    this.#io?.disconnect?.();
    this.#io = null;
  }
  attributeChangedCallback() {
    this.#render();
  }

  #fmtDate(v) {
    if (!v) return '';
    const d = new Date(v);
    if (!isNaN(d))
      return d
        .toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })
        .replace('.', '');
    return String(v);
  }

  #normalizeViewerLink(href) {
    try {
      const u = new URL(href, location.href);
      if (/\/viewer(\.html)?$/i.test(u.pathname)) {
        const sp = new URLSearchParams(u.search);
        const rawUrl = sp.get('url');
        const rawPath = sp.get('path');
        if (rawPath) return `/viewer?path=${rawPath}`;
        if (rawUrl) {
          let decoded = rawUrl;
          try {
            decoded = decodeURIComponent(decoded);
          } catch {}
          const p = pathOf(decoded);
          return viewerHref(p);
        }
      }
    } catch {}
    return href;
  }

  #render() {
    let href = this.getAttribute('href') || '#';
    href = this.#normalizeViewerLink(href);

    const thumb = this.getAttribute('thumb') || '';
    const title = this.getAttribute('title') || '';
    const date = this.getAttribute('date') || '';
    const comments = this.getAttribute('comments') || '';
    const badge = this.getAttribute('badge') || '';
    const flag = flagFrom(this.getAttribute('flag') || '');
    const tags = parseTagsAttr(this.getAttribute('tags'));

    if (this.$a) this.$a.href = href;
    if (this.$img) {
      this.$img.src = thumb;
      this.$img.alt = title || 'cover';
    }
    if (this.$title) this.$title.textContent = title;

    if (flag) {
      this.$flag.textContent = flag;
      this.$flag.classList.remove('hidden');
    } else this.$flag.classList.add('hidden');
    if (badge) {
      this.$badge.textContent = badge;
      this.$badge.classList.remove('hidden');
    } else this.$badge.classList.add('hidden');

    if (date && this.$metaDate && this.$metaDateI) {
      this.$metaDateI.textContent = this.#fmtDate(date);
      this.$metaDate.classList.remove('hidden');
    } else this.$metaDate?.classList.add('hidden');
    if (String(comments || '') && this.$metaComments && this.$metaCommentsI) {
      this.$metaCommentsI.textContent = String(comments);
      this.$metaComments.classList.remove('hidden');
    } else this.$metaComments?.classList.add('hidden');

    if (this.$chips) {
      this.$chips.innerHTML = '';
      const top = tags.slice(0, 3);
      top.forEach((t) => {
        const pill = document.createElement('span');
        pill.className = 'chip';
        pill.textContent = t;
        this.$chips.appendChild(pill);
      });
      const rest = clamp(tags.length - top.length, 0, 999);
      if (rest > 0) {
        const more = document.createElement('span');
        more.className = 'chip more';
        more.textContent = '+' + rest;
        this.$chips.appendChild(more);
      }
    }
  }

  #srcFromHref() {
    const href = this.getAttribute('href') || '';
    try {
      const u = new URL(href, location.href);
      const q = new URLSearchParams(u.search);
      return q.get('path') || q.get('url') || '';
    } catch {
      return '';
    }
  }

  async #enhance() {
    if (this.#enhanced) return;
    this.#enhanced = true;
    try {
      const src = this.getAttribute('source') || this.#srcFromHref();
      if (!src) return;

      const endpoint = src.startsWith('/')
        ? '/api/resolve?path=' + encodeURIComponent(src)
        : '/api/resolve?url=' + encodeURIComponent(src);

      const r = await fetch(endpoint);
      const j = await r.json();
      const meta = j?.data?.viewer?.meta || {};
      const rawTags = []
        .concat(Array.isArray(meta.tags) ? meta.tags.map((t) => t?.title).filter(Boolean) : [])
        .concat(
          Array.isArray(meta.userTags) ? meta.userTags.map((t) => t?.title).filter(Boolean) : [],
        );
      if (!this.getAttribute('tags') && rawTags.length) {
        this.setAttribute('tags', JSON.stringify(rawTags.slice(0, 8)));
      }
    } catch {}
  }

  #observe() {
    if (this.getAttribute('enhance') !== 'auto') return;
    const fn = () => this.#enhance();
    if ('IntersectionObserver' in window) {
      this.#io = new IntersectionObserver(
        (es) => {
          for (const e of es) {
            if (e.isIntersecting) {
              this.#io.disconnect();
              fn();
              break;
            }
          }
        },
        { rootMargin: '200px' },
      );
      this.#io.observe(this);
    } else fn();
  }
}

class TileGrid extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>:host{display:block}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}</style>
      <div class="grid"><slot></slot></div>
    `;
  }
}
customElements.define('tile-card', TileCard);
customElements.define('tile-grid', TileGrid);

export { hubHref, viewerHref, pathOf };
