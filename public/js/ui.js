import { reducedMotion } from './util.js';

// ---- トースト（元に戻す付き） ----
let toastTimer = 0;
export function toast(msg, opt = {}) {
  const el = document.getElementById('toast');
  clearTimeout(toastTimer);
  el.innerHTML = '';
  const span = document.createElement('span');
  span.className = 'toast-msg';
  span.textContent = msg;
  el.appendChild(span);
  if (opt.action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-action rp';
    b.textContent = opt.action;
    b.addEventListener('click', () => { hideToast(); opt.onAction?.(); });
    el.appendChild(b);
  }
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  toastTimer = setTimeout(hideToast, opt.duration || 5000);
}
export function hideToast() {
  clearTimeout(toastTimer);
  document.getElementById('toast').classList.remove('show');
}

// ---- タップ時のリップル ----
export function installRipple() {
  document.addEventListener('pointerdown', (e) => {
    const t = e.target.closest('.rp');
    if (!t || reducedMotion()) return;
    const r = t.getBoundingClientRect();
    const d = Math.max(r.width, r.height) * 2;
    const s = document.createElement('span');
    s.className = 'ripple';
    s.style.width = s.style.height = d + 'px';
    s.style.left = e.clientX - r.left - d / 2 + 'px';
    s.style.top = e.clientY - r.top - d / 2 + 'px';
    t.appendChild(s);
    setTimeout(() => s.remove(), 650);
  }, { passive: true });
}

// ---- 数字のカウントアップ ----
export function countUp(el, to, { dur = 900, format = (n) => '¥' + Math.round(n).toLocaleString('ja-JP') } = {}) {
  el.dataset.value = String(to);
  if (reducedMotion()) { el.textContent = format(to); return; }
  const from = Number(el.dataset.from || 0);
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - (1 - k) ** 3;
    el.textContent = format(from + (to - from) * e);
    if (k < 1 && el.isConnected) requestAnimationFrame(step);
    else el.dataset.from = String(to);
  };
  requestAnimationFrame(step);
}

/**
 * 横スワイプ検出（pointer events）。要素は CSS で touch-action: pan-y にしておく。
 * onMove(dx) / onEnd(dx, vx) を返す
 */
export function onHSwipe(el, { onMove, onEnd, threshold = 10 } = {}) {
  let st = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    st = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, active: false, target: e.target };
  });
  el.addEventListener('pointermove', (e) => {
    if (!st || e.pointerId !== st.id) return;
    const dx = e.clientX - st.x; const dy = e.clientY - st.y;
    if (!st.active) {
      if (Math.abs(dy) > threshold && Math.abs(dy) > Math.abs(dx)) { st = null; return; }
      if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy)) {
        st.active = true;
        try { el.setPointerCapture(e.pointerId); } catch { /* noop */ }
      }
    }
    if (st?.active) onMove?.(dx, st.target);
  });
  const end = (e) => {
    if (!st || e.pointerId !== st.id) return;
    const s = st; st = null;
    if (!s.active) return;
    const dx = e.clientX - s.x;
    const vx = dx / Math.max(1, performance.now() - s.t);
    // スワイプ直後の click を抑止
    const block = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    el.addEventListener('click', block, { capture: true, once: true });
    setTimeout(() => el.removeEventListener('click', block, { capture: true }), 50);
    onEnd?.(e.type === 'pointercancel' ? 0 : dx, vx, s.target);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
