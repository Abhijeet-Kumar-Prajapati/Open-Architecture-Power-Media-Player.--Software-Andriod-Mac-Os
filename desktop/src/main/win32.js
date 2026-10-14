'use strict';
/**
 * APM Open Player - Win32 interop layer
 * ---------------------------------------------------------------------------
 * Pure-JS binding to user32.dll via koffi. We use this to create the native
 * container window that hosts the libmpv video output inside the Electron
 * window, and to forward mouse/keyboard input that the renderer cannot see.
 *
 * Only used on Windows. On macOS the renderer paints directly (see video.js).
 */

const path = require('path');
const koffi = require('koffi');

// ---------------------------------------------------------------------------
// Win32 constants
// ---------------------------------------------------------------------------
const WS = {
  POPUP: 0x80000000,
  CHILD: 0x40000000,
  VISIBLE: 0x10000000,
  CLIPCHILDREN: 0x02000000,
  CLIPSIBLINGS: 0x04000000,
  BORDER: 0x00800000,
  CAPTION: 0x00c00000,
  THICKFRAME: 0x00040000,
  MINIMIZEBOX: 0x00020000,
  MAXIMIZEBOX: 0x00010000,
  SYSMENU: 0x00080000,
  OVERLAPPEDWINDOW: 0x00cf0000,
};

const SWP = {
  NOSIZE: 0x0001,
  NOMOVE: 0x0002,
  NOZORDER: 0x0004,
  NOACTIVATE: 0x0010,
  FRAMECHANGED: 0x0020,
  SHOWWINDOW: 0x0040,
  NOOWNERZORDER: 0x0200,
};

const WM = {
  DESTROY: 0x0002,
  SIZE: 0x0005,
  SETFOCUS: 0x0007,
  KILLFOCUS: 0x0008,
  PAINT: 0x000f,
  CLOSE: 0x0010,
  ERASEBKGND: 0x0014,
  MOUSEMOVE: 0x0200,
  LBUTTONDOWN: 0x0201,
  LBUTTONUP: 0x0202,
  LBUTTONDBLCLK: 0x0203,
  MOUSEWHEEL: 0x020a,
  MOUSEHWHEEL: 0x020b,
  MOUSELEAVE: 0x02a3,
  KEYDOWN: 0x0100,
  KEYUP: 0x0101,
  CHAR: 0x0102,
  SETCURSOR: 0x0020,
  GETMINMAXINFO: 0x0024,
  DISPLAYCHANGE: 0x007e,
  APPDEACTIVATE: 0x001c,
  NCACTIVATE: 0x0086,
};

const GWLP_WNDPROC = -4;
const SM_CXSCREEN = 0;
const SM_CYSCREEN = 1;

let user32 = null;
let gdi32 = null;

/**
 * koffi.proto() registers a globally named type, so it must only be created
 * once per process - a second call with the same name throws.
 */
let _wndProcType = null;
function wndProcType() {
  if (!_wndProcType) {
    _wndProcType = koffi.proto('APM_VideoHostProc', 'intptr_t', ['void *', 'uint32_t', 'intptr_t', 'intptr_t']);
  }
  return _wndProcType;
}

function load() {
  if (user32) return;
  user32 = koffi.load('user32.dll');
  gdi32 = koffi.load('gdi32.dll');
}

const fn = () => {
  if (!user32) load();
  return user32;
};

const f = {
  CreateWindowExA: () =>
    fn().func(
      ' void * CreateWindowExA(uint32_t, const char *, const char *, uint32_t, int32_t, int32_t, int32_t, int32_t, void *, void *, void *, void *)'
    ),
  DestroyWindow: () => fn().func(' int DestroyWindow(void *)'),
  SetWindowPos: () =>
    fn().func(' int SetWindowPos(void *, void *, int32_t, int32_t, int32_t, int32_t, uint32_t)'),
  ShowWindow: () => fn().func(' int ShowWindow(void *, int32_t)'),
  UpdateWindow: () => fn().func(' int UpdateWindow(void *)'),
  RedrawWindow: () =>
    fn().func(' int RedrawWindow(void *, void *, void *, uint32_t)'),
  GetWindow: () => fn().func(' void * GetWindow(void *, uint32_t)'),
  GetParent: () => fn().func(' void * GetParent(void *)'),
  GetClientRect: () => fn().func(' int GetClientRect(void *, int32_t *)'),
  GetWindowRect: () => fn().func(' int GetWindowRect(void *, int32_t *)'),
  ClientToScreen: () => fn().func(' int ClientToScreen(void *, int32_t *)'),
  ScreenToClient: () => fn().func(' int ScreenToClient(void *, int32_t *)'),
  SetWindowLongPtrA: () =>
    fn().func(' intptr_t SetWindowLongPtrA(void *, int32_t, intptr_t)'),
  GetWindowLongPtrA: () => fn().func(' intptr_t GetWindowLongPtrA(void *, int32_t)'),
  CallWindowProcA: () =>
    fn().func(' intptr_t CallWindowProcA(intptr_t, void *, uint32_t, intptr_t, intptr_t)'),
  DefWindowProcA: () =>
    fn().func(' intptr_t DefWindowProcA(void *, uint32_t, intptr_t, intptr_t)'),
  SendMessageA: () =>
    fn().func(' intptr_t SendMessageA(void *, uint32_t, intptr_t, intptr_t)'),
  PostMessageA: () => fn().func(' int PostMessageA(void *, uint32_t, intptr_t, intptr_t)'),
  SetForegroundWindow: () => fn().func(' int SetForegroundWindow(void *)'),
  GetForegroundWindow: () => fn().func(' void * GetForegroundWindow()'),
  SetFocus: () => fn().func(' void * SetFocus(void *)'),
  GetCursorPos: () => fn().func(' int GetCursorPos(int32_t *)'),
  SystemParametersInfoA: () =>
    fn().func(' int SystemParametersInfoA(uint32_t, uint32_t, void *, uint32_t)'),
  GetDpiForWindow: () => fn().func(' uint32_t GetDpiForWindow(void *)'),
  MonitorFromWindow: () => fn().func(' void * MonitorFromWindow(void *, uint32_t)'),
  EnableMouseInPointer: () => fn().func(' int EnableMouseInPointer(uint32_t)'),
  TrackMouseEvent: () => fn().func(' int TrackMouseEvent(void *)'),
};

const GW_OWNER = 4;
const RDW_INVALIDATE = 0x0001;
const RDW_UPDATENOW = 0x0100;
const RDW_ALLCHILDREN = 0x0080;
const SM_CXSCREEN_IDX = SM_CXSCREEN;

/** Minimal RECT/POINT helper backed by a 4x int32 scratch buffer. */
function makeRect() {
  const buf = koffi.alloc(16, 'uint8_t');
  return {
    _buf: buf,
    left: () => koffi.decode(buf, 'int32', 1)[0],
    top: () => koffi.decode(buf, 'int32', 1)[0],
    right: () => koffi.decode(buf, 'int32', 2)[1],
    bottom: () => koffi.decode(buf, 'int32', 2)[1],
    width: () => koffi.decode(buf, 'int32', 2)[1] - koffi.decode(buf, 'int32', 1)[0],
    height: () => koffi.decode(buf, 'int32', 2)[1] - koffi.decode(buf, 'int32', 2)[1],
  };
}

/**
 * A native child window that mpv renders into.
 *
 * mpv's `mpv_create_window` with MPV_WINDOW_PARAM_FORMAT_WIN32 reparents its
 * own rendering surface inside whatever HWND we hand it and subclasses it to
 * track resize. So we create an invisible-by-default container sized to the
 * video area of the UI, and move it whenever the layout changes.
 */
class VideoHost {
  constructor(parentHwnd) {
    if (!parentHwnd) throw new Error('VideoHost: parent HWND required');
    this.parent = parentHwnd;
    this.hwnd = null;
    this._prevWndProc = null;
    this._wndProc = null;
    this._rect = { x: 0, y: 0, w: 0, h: 0 };
    this._visible = false;
    this._mpvWindow = null; // set by the engine (mpv's own child HWND)
    this._onCommand = null; // (name) => void
    this._create();
  }

  _create() {
    const style = WS.CHILD | WS.CLIPCHILDREN | WS.CLIPSIBLINGS;
    this.hwnd = f.CreateWindowExA()(
      0,
      'STATIC',
      'APMVideoHost',
      style,
      0,
      0,
      16,
      16,
      this.parent,
      null,
      null,
      null
    );
    if (!this.hwnd) throw new Error('VideoHost: CreateWindowEx failed');
    this._subclass();
  }

  /** Subclass so we can forward clicks/wheel that never reach the renderer. */
  _subclass() {
    if (this._wndProc) return;
    const self = this;
    // koffi needs the callback type declared first, then a pointer to it.
    const WndProcType = wndProcType();
    const registered = koffi.register(
      (hwnd, msg, wparam, lparam) => {
        try {
          const handled = self._handleMessage(hwnd, msg, wparam, lparam);
          if (handled !== undefined) return handled;
        } catch (err) {
          try {
            console.error('[VideoHost] wndproc error:', err);
          } catch (_) {}
        }
        return Number(f.CallWindowProcA()(self._prevWndProc, hwnd, msg, wparam, lparam));
      },
      koffi.pointer(WndProcType)
    );
    this._wndProc = Number(registered);
    this._registered = registered;
    this._prevWndProc = f.SetWindowLongPtrA()(this.hwnd, GWLP_WNDPROC, this._wndProc);
  }

  _handleMessage(hwnd, msg, wparam, lparam) {
    switch (msg) {
      case WM.LBUTTONDOWN:
      case WM.LBUTTONUP: {
        // Forward to mpv's real surface so vo-level handling still works.
        if (this._mpvWindow) f.SendMessageA()(this._mpvWindow, msg, wparam, lparam);
        if (this._onCommand) this._onCommand(msg === WM.LBUTTONDOWN ? 'pointer-down' : 'pointer-up');
        return 0;
      }
      case WM.LBUTTONDBLCLK: {
        if (this._mpvWindow) f.SendMessageA()(this._mpvWindow, msg, wparam, lparam);
        if (this._onCommand) this._onCommand('double-click');
        return 0;
      }
      case WM.MOUSEWHEEL: {
        // wparam high word carries the signed delta (120 units per notch).
        const delta = (wparam >> 16) & 0xffff;
        const signed = delta > 0x7fff ? delta - 0x10000 : delta;
        if (this._onCommand) this._onCommand('wheel', signed);
        return 0;
      }
      case WM.SIZE: {
        if (this._mpvWindow) f.SendMessageA()(this._mpvWindow, msg, wparam, lparam);
        return undefined;
      }
      default:
        return undefined;
    }
  }

  /** Called by the engine once mpv has created its own child window. */
  attachMpvWindow(mpvWindowHwnd) {
    this._mpvWindow = mpvWindowHwnd;
  }

  onCommand(cb) {
    this._onCommand = cb;
  }

  /** Position/size the host in *client* coordinates of the parent window. */
  setRect(x, y, w, h) {
    const r = this._rect;
    if (r.x === x && r.y === y && r.w === w && r.h === h) return;
    r.x = x;
    r.y = y;
    r.w = w;
    r.h = h;
    f.SetWindowPos()(this.hwnd, null, Math.round(x), Math.round(y), Math.max(0, Math.round(w)), Math.max(0, Math.round(h)), SWP.NOZORDER | SWP.NOACTIVATE | SWP.SHOWWINDOW);
    f.InvalidateRect ? 0 : 0;
  }

  getRect() {
    return { ...this._rect };
  }

  show() {
    if (this._visible) return;
    this._visible = true;
    f.ShowWindow()(this.hwnd, 1 /* SW_SHOWNOACTIVATE */);
    f.SetWindowPos()(this.hwnd, null, this._rect.x, this._rect.y, this._rect.w, this._rect.h, SWP.NOACTIVATE | SWP.SHOWWINDOW);
  }

  hide() {
    if (!this._visible) return;
    this._visible = false;
    f.ShowWindow()(this.hwnd, 0 /* SW_HIDE */);
  }

  /** Reposition above/below Chromium's own child windows. */
  raise() {
    f.SetWindowPos()(this.hwnd, null, this._rect.x, this._rect.y, this._rect.w, this._rect.h, SWP.NOACTIVATE | SWP.SHOWWINDOW);
  }

  get scaleFactor() {
    try {
      const dpi = f.GetDpiForWindow()(this.parent);
      return dpi ? dpi / 96 : 1;
    } catch (_) {
      return 1;
    }
  }

  destroy() {
    if (!this.hwnd) return;
    try {
      if (this._prevWndProc) f.SetWindowLongPtrA()(this.hwnd, GWLP_WNDPROC, this._prevWndProc);
    } catch (_) {}
    try {
      f.DestroyWindow()(this.hwnd);
    } catch (_) {}
    // Release the callback slot - only 8192 can exist at once.
    if (this._registered !== undefined) {
      try {
        koffi.unregister(this._registered);
      } catch (_) {}
      this._registered = undefined;
    }
    this.hwnd = null;
    this._prevWndProc = null;
    this._wndProc = null;
  }
}

function clientSize(hwnd) {
  const r = makeRect();
  f.GetClientRect()(hwnd, r._buf);
  return { width: r.width(), height: r.height() };
}

function clientRect(hwnd) {
  const r = makeRect();
  f.GetClientRect()(hwnd, r._buf);
  return { left: r.left(), top: r.top(), right: r.right(), bottom: r.bottom() };
}

function screenSize() {
  const user32b = fn();
  const GetSystemMetrics = user32b.func(' int32_t GetSystemMetrics(int32_t)');
  return { width: GetSystemMetrics(SM_CXSCREEN_IDX), height: GetSystemMetrics(SM_CYSCREEN) };
}

module.exports = { VideoHost, clientSize, clientRect, screenSize, WS, SWP, WM, makeRect, koffi };