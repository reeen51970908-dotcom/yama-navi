// ライブラリなしの簡易タイル地図（国土地理院 淡色地図）
const TILE = 256;
export const TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png';
const MINZ = 5;
const MAXZ = 17;

export function project(lat, lon, z) {
  const s = TILE * 2 ** z;
  const x = ((lon + 180) / 360) * s;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * s;
  return { x, y };
}

export class TileMap {
  constructor(el) {
    this.el = el;
    this.el.classList.add('tmap');
    this.el.innerHTML = `
      <div class="tmap-tiles" aria-hidden="true"></div>
      <svg class="tmap-svg" aria-hidden="true"><path class="route" d=""/></svg>
      <div class="tmap-label" hidden></div>
      <div class="pin pin-s" title="出発地"><span class="pin-in"><b>S</b></span></div>
      <div class="pin pin-g" title="登山口"><span class="pin-in"><b>G</b></span></div>
      <div class="tmap-ctrl">
        <button type="button" class="tmap-btn rp" data-act="in" aria-label="拡大">＋</button>
        <button type="button" class="tmap-btn rp" data-act="out" aria-label="縮小">－</button>
        <button type="button" class="tmap-btn rp" data-act="fit" aria-label="全体表示">⤢</button>
      </div>
      <a class="tmap-attr" href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>`;
    this.tilesEl = el.querySelector('.tmap-tiles');
    this.route = el.querySelector('.route');
    this.label = el.querySelector('.tmap-label');
    this.pinS = el.querySelector('.pin-s');
    this.pinG = el.querySelector('.pin-g');
    this.tiles = new Map();
    this.z = 10; this.cx = 0; this.cy = 0;
    this.drawn = false;
    el.querySelector('.tmap-ctrl').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'in') this.zoomBy(1);
      else if (b.dataset.act === 'out') this.zoomBy(-1);
      else this.fit();
    });
    this.bindDrag();
    this.ro = new ResizeObserver(() => { if (this.S && this.el.clientWidth && !this.userMoved) this.fit(false); else this.render(); });
    this.ro.observe(el);
  }

  destroy() { this.ro.disconnect(); this.el.innerHTML = ''; this.tiles.clear(); }

  setPoints(S, G, labelText) {
    this.S = S; this.G = G; this.labelText = labelText;
    this.userMoved = false;
    this.drawn = false;
    for (const p of [this.pinS, this.pinG]) { p.classList.remove('drop'); void p.offsetWidth; p.classList.add('drop'); }
    this.fit(false);
    this.animateRoute();
  }

  fit(animate = true) {
    if (!this.S) return;
    const W = this.el.clientWidth; const H = this.el.clientHeight;
    if (!W || !H) return;
    let z = MAXZ - 2;
    for (; z > MINZ; z--) {
      const a = project(this.S.lat, this.S.lon, z); const b = project(this.G.lat, this.G.lon, z);
      if (Math.abs(a.x - b.x) + 2 * 44 <= W && Math.abs(a.y - b.y) + 56 + 30 <= H) break;
    }
    this.z = z;
    const a = project(this.S.lat, this.S.lon, z); const b = project(this.G.lat, this.G.lon, z);
    this.cx = (a.x + b.x) / 2; this.cy = (a.y + b.y) / 2 - 12;
    this.userMoved = false;
    this.render(animate);
  }

  zoomBy(d) {
    const nz = Math.max(MINZ, Math.min(MAXZ, this.z + d));
    if (nz === this.z) return;
    const k = 2 ** (nz - this.z);
    this.cx *= k; this.cy *= k; this.z = nz;
    this.userMoved = true;
    this.render(true);
  }

  bindDrag() {
    let start = null;
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.tmap-ctrl, .tmap-attr')) return;
      start = { x: e.clientX, y: e.clientY, cx: this.cx, cy: this.cy, id: e.pointerId };
      this.el.setPointerCapture?.(e.pointerId);
      this.el.classList.add('dragging');
    });
    this.el.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      this.cx = start.cx - (e.clientX - start.x);
      this.cy = start.cy - (e.clientY - start.y);
      this.userMoved = true;
      this.render();
    });
    const end = (e) => {
      if (!start || e.pointerId !== start.id) return;
      start = null;
      this.el.classList.remove('dragging');
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
  }

  render(animate = false) {
    const W = this.el.clientWidth; const H = this.el.clientHeight;
    if (!W || !H) return;
    const z = this.z; const n = 2 ** z;
    const ox = this.cx - W / 2; const oy = this.cy - H / 2;
    this.el.dataset.zoom = String(z);
    this.el.dataset.center = `${Math.round(this.cx)},${Math.round(this.cy)}`;
    this.tilesEl.classList.toggle('zooming', animate);
    const want = new Set();
    const x0 = Math.floor(ox / TILE); const x1 = Math.floor((ox + W) / TILE);
    const y0 = Math.max(0, Math.floor(oy / TILE)); const y1 = Math.min(n - 1, Math.floor((oy + H) / TILE));
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const wx = ((tx % n) + n) % n;
        const key = `${z}/${tx}/${ty}`;
        want.add(key);
        let img = this.tiles.get(key);
        if (!img) {
          img = new Image();
          img.alt = ''; img.draggable = false; img.decoding = 'async';
          img.className = 'tile';
          img.onload = () => img.classList.add('ok');
          img.onerror = () => img.classList.add('ng');
          img.src = TILE_URL.replace('{z}', z).replace('{x}', wx).replace('{y}', ty);
          this.tiles.set(key, img);
          this.tilesEl.appendChild(img);
        }
        img.style.transform = `translate(${tx * TILE - ox}px, ${ty * TILE - oy}px)`;
      }
    }
    for (const [k, img] of this.tiles) if (!want.has(k)) { img.remove(); this.tiles.delete(k); }
    if (!this.S) return;
    const a = project(this.S.lat, this.S.lon, z); const b = project(this.G.lat, this.G.lon, z);
    const sx = a.x - ox; const sy = a.y - oy; const gx = b.x - ox; const gy = b.y - oy;
    this.pinS.style.transform = `translate(${sx}px, ${sy}px)`;
    this.pinG.style.transform = `translate(${gx}px, ${gy}px)`;
    const dx = gx - sx; const dy = gy - sy; const len = Math.hypot(dx, dy);
    const bend = Math.min(80, len * 0.22);
    const mx = (sx + gx) / 2 - (dy / (len || 1)) * bend;
    const my = (sy + gy) / 2 + (dx / (len || 1)) * bend;
    this.route.setAttribute('d', `M${sx.toFixed(1)} ${sy.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${gx.toFixed(1)} ${gy.toFixed(1)}`);
    // 曲線の中点（t=0.5）
    const lx = 0.25 * sx + 0.5 * mx + 0.25 * gx; const ly = 0.25 * sy + 0.5 * my + 0.25 * gy;
    if (this.labelText) {
      this.label.hidden = false;
      this.label.textContent = this.labelText;
      this.label.style.transform = `translate(${lx}px, ${ly}px) translate(-50%, -50%)`;
    }
    if (!this.drawn) this.syncDash();
  }

  syncDash() {
    const L = this.route.getTotalLength?.() || 0;
    this.route.style.strokeDasharray = `${L} ${L}`;
    return L;
  }

  animateRoute() {
    const L = this.syncDash();
    this.route.style.transition = 'none';
    this.route.style.strokeDashoffset = String(L);
    this.label.classList.remove('show');
    void this.route.getBoundingClientRect();
    requestAnimationFrame(() => {
      this.route.style.transition = '';
      this.route.style.strokeDashoffset = '0';
      this.label.classList.add('show');
      setTimeout(() => { this.drawn = true; this.route.style.strokeDasharray = 'none'; }, 1300);
    });
  }
}
