'use strict';
(function () {
/** Small DOM + formatting helpers shared by the renderer modules. */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

function svg(viewBox, pathHtml, extra = '') {
  return `<svg viewBox="${viewBox}" ${extra}>${pathHtml}</svg>`;
}

/** mm:ss, or h:mm:ss past an hour. */
function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

function fmtSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

function fmtAgo(ts) {
  if (!ts) return '';
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const day = Math.floor(h / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ts).toLocaleDateString();
}

function fmtRes(w, h) {
  if (!w || !h) return '';
  const g = Math.gcd(w, h);
  const rw = w / g;
  const rh = h / g;
  if (rw <= 32 && rh <= 32) return `${rw}:${rh}`;
  const known = { '16:9': 'HD', '4:3': 'SD', '1:1': '1:1', '21:9': 'CINEMA', '9:16': 'VERTICAL' };
  if (rw === 16 && rh === 9) return `${h}p`;
  if (rw === 4 && rh === 3) return `${h}p`;
  return `${w}×${h}`;
}

function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function throttle(fn, ms) {
  let last = 0;
  let pending = null;
  return (...args) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    } else {
      clearTimeout(pending);
      pending = setTimeout(() => {
        last = Date.now();
        fn(...args);
      }, ms - (now - last));
    }
  };
}

const baseName = (p) => String(p || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
const fileExt = (p) => (String(p || '').match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();

function isNetworkUrl(s) {
  return /^(https?|rtsp|rtmps?|udp|tcp|srt|mms|mmsh|ftp|ftps?|sftp|rist):\/\//i.test(String(s || '').trim());
}

/** Pretty one-line summary of a probed file, for list rows. */
function mediaSummary(info) {
  if (!info || !info.ok) return info && info.error ? 'unreadable' : '';
  const bits = [];
  if (info.video) {
    bits.push(info.video.codecName || info.video.codec);
    if (info.video.width) bits.push(fmtRes(info.video.width, info.video.height));
    if (info.video.hdr) bits.push(info.video.hdrScheme || 'HDR');
  }
  if (info.audio && info.audio.length) bits.push(info.audio[0].codecName || info.audio[0].codec);
  if (info.subtitles && info.subtitles.length) bits.push(`${info.subtitles.length} sub`);
  return bits.filter(Boolean).join(' · ');
}

// --- transient UI ---------------------------------------------------------
const toastStack = () => document.getElementById('toastStack');
function toast(message, kind = '', ms = 3200) {
  const t = el('div', { class: `toast ${kind}` }, message);
  toastStack().append(t);
  setTimeout(() => {
    t.style.transition = 'opacity .2s, transform .2s';
    t.style.opacity = '0';
    t.style.transform = 'translateY(6px)';
    setTimeout(() => t.remove(), 220);
  }, ms);
  return t;
}

/** The strip above the video - the only place overlays can safely appear. */
const noticeStrip = () => document.getElementById('noticeStrip');
let noticeTimer = null;
function notice(text, kind = '', action = null, ms = 3200) {
  const strip = noticeStrip();
  if (!strip) return;
  strip.innerHTML = '';
  strip.className = `notice-strip is-active ${kind ? `is-${kind}` : ''}`;
  if (text) strip.append(el('span', { class: 'ns-text' }, text));
  if (action) {
    strip.append(
      el('button', {
        class: 'ns-action',
        onclick: () => {
          action.onClick();
          clearNotice();
        },
      }, action.label)
    );
  }
  clearTimeout(noticeTimer);
  if (ms > 0) noticeTimer = setTimeout(clearNotice, ms);
}
function clearNotice() {
  const strip = noticeStrip();
  if (!strip) return;
  strip.innerHTML = '';
  strip.className = 'notice-strip';
}

window.APMUtil = { $, $$, el, svg, fmtTime, fmtSize, fmtAgo, fmtRes, debounce, throttle, toast, notice, clearNotice, baseName, fileExt, isNetworkUrl, mediaSummary };
})();
