'use strict';
(function () {
/**
 * Popovers and modals: track pickers, media/codec information, effects,
 * converter, preferences, supported-format reference, shortcuts and about.
 */

const { $, $$, el, fmtTime, fmtSize, toast, notice } = window.APMUtil;

const Dialogs = {
  _pops: [],
  _anchors: [],
  _modals: [],

  // ── popover ────────────────────────────────────────────────────────────
  popover(anchor, items) {
    const pop = el('div', { class: 'popover list-select' });
    for (const it of items) {
      if (it.sep) { pop.append(el('div', { class: 'pop-sep' })); continue; }
      if (it.title) { pop.append(el('div', { class: 'pop-title' }, it.title)); continue; }
      const row = el('button', {
        class: `pop-item${it.on ? ' is-on' : ''}`,
        disabled: it.disabled || false,
        // The anchor is handed to onClick so an item can open a submenu
        // positioned against itself.
        onclick: () => { if (it.stays) { it.onClick && it.onClick(anchor, row); return; } this.closePopover(); it.onClick && it.onClick(anchor, row); },
      },
        it.label,
        it.sub ? el('span', { class: 'pop-sub' }, it.sub) : null);
      pop.append(row);
    }
    $('#layerHost').append(pop);

    const r = anchor.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    let left = r.left;
    let top = r.bottom + 6;
    if (left + pr.width > window.innerWidth - 8) left = window.innerWidth - pr.width - 8;
    if (top + pr.height > window.innerHeight - 8) top = r.top - pr.height - 6;
    pop.style.left = `${Math.max(8, left)}px`;
    pop.style.top = `${Math.max(8, top)}px`;

    // Popovers stack, so opening "Subtitles" from the ⋯ menu keeps the menu
    // behind it instead of replacing it.
    this._pops.push(pop);
    return pop;
  },

  popoverAt(x, y, items) {
    const anchor = el('span', { style: { position: 'fixed', left: `${x}px`, top: `${y - 6}px`, width: '1px', height: '1px' } });
    document.body.append(anchor);
    const pop = this.popover(anchor, items);
    this._anchors.push(anchor);
    return pop;
  },

  closePopover() {
    for (const p of this._pops) p.remove();
    for (const a of this._anchors) a.remove();
    this._pops = [];
    this._anchors = [];
  },

  // ── modal ──────────────────────────────────────────────────────────────
  modal({ title, body, footer, width, onClose }) {
    const back = el('div', { class: 'modal-back' });
    const box = el('div', { class: 'modal', style: width ? { width } : null });
    const head = el('div', { class: 'modal-head' },
      el('h3', {}, title),
      el('button', { class: 'modal-x', onclick: () => close() }, el('span', { html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' })));
    const bodyEl = el('div', { class: 'modal-body' });
    if (body) bodyEl.append(body);
    box.append(head, bodyEl);
    if (footer) box.append(el('div', { class: 'modal-foot' }, ...footer));
    back.append(box);
    $('#layerHost').append(back);

    const entry = { back, close, onClose };
    this._modals.push(entry);
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });

    function close() {
      const i = Dialogs._modals.indexOf(entry);
      if (i < 0) return;
      Dialogs._modals.splice(i, 1);
      back.remove();
      if (entry.onClose) entry.onClose();
    }
    entry.close = close;
    return { el: box, body: bodyEl, close, head };
  },

  closeTop() {
    this.closePopover();
    if (this._modals.length) this._modals[this._modals.length - 1].close();
  },

  isModalOpen() {
    // An open popover counts too: Escape has to close the ⋯ menu before the
    // key reaches the transport shortcuts underneath it.
    return this._modals.length > 0 || this._pops.length > 0;
  },

  /** Modal with a tab strip. */
  tabbedModal(title, tabs) {
    const body = el('div');
    const strip = el('div', { class: 'tabs' });
    const m = this.modal({ title, body, width: '760px' });
    m.el.insertBefore(strip, body);

    const show = (i) => {
      $$('.tab', strip).forEach((t, j) => t.classList.toggle('is-on', i === j));
      body.innerHTML = '';
      body.append(tabs[i].render());
    };
    tabs.forEach((t, i) => strip.append(el('button', { class: 'tab', onclick: () => show(i) }, t.name)));
    show(0);
    return m;
  },

  // ── track menus ────────────────────────────────────────────────────────
  subtitleMenu(anchor) {
    const items = [{ label: 'Add subtitle file…', onClick: () => this.addSubtitle() }, { sep: true }];
    const subs = State.info?.subtitles || [];
    if (!subs.length && !State.externalSubs.length) {
      items.push({ label: 'No subtitle tracks in this file', disabled: true });
    }
    items.push({ label: 'Off', on: State.activeSubId === 'no' || State.activeSubId === null, onClick: () => window.apm.command('subTrack', { id: 'no' }) });
    subs.forEach((s) => {
      items.push({
        label: `${s.codecName || s.codec}${s.language ? ` — ${s.language}` : ''}${s.title ? ` (${s.title})` : ''}`,
        sub: s.forced ? 'forced' : '',
        on: String(State.activeSubId) === String(s.index),
        onClick: () => window.apm.command('subTrack', { id: s.index }),
      });
    });
    State.externalSubs.forEach((s, i) => {
      items.push({ label: `${window.APMUtil.baseName(s)} (added)`, on: State.activeSubId === `ext${i}`, onClick: () => window.apm.command('subTrack', { id: `ext${i}` }) });
    });
    this.popover(anchor, items);
  },

  async addSubtitle() {
    const r = await window.apm.openDialog();
    if (r.canceled || !r.files.length) return;
    for (const f of r.files) {
      if (!/\.(srt|ass|ssa|sub|idx|vtt|smi|sami)$/i.test(f)) {
        toast('That does not look like a subtitle file', 'is-error');
        return;
      }
    }
    for (const f of r.files) {
      await window.apm.command('loadSubtitle', { path: f });
      State.externalSubs.push(f);
    }
    toast(`Loaded ${r.files.length} subtitle file(s)`, 'is-good');
  },

  audioTrackMenu(anchor) {
    const items = [{ label: 'Disable audio', onClick: () => window.apm.command('audioTrack', { id: 'no' }) }, { sep: true }];
    (State.info?.audio || []).forEach((a) => {
      items.push({
        label: `${a.codecName || a.codec}${a.language ? ` — ${a.language}` : ''}`,
        sub: a.channelLayout || `${a.channels || '?'}ch`,
        on: String(State.activeAudioId) === String(a.index),
        onClick: () => { State.activeAudioId = a.index; window.apm.command('audioTrack', { id: a.index }); },
      });
    });
    if (!(State.info?.audio || []).length) items.unshift({ label: 'No audio tracks', disabled: true });
    this.popover(anchor, items);
  },

  videoTrackMenu(anchor) {
    const v = State.info?.video;
    this.popover(anchor, [
      { label: 'Disable video', onClick: () => window.apm.command('videoTrack', { id: 'no' }) },
      ...(v ? [{ sep: true }, {
        label: `${v.codecName || v.codec} — ${v.width}×${v.height}${v.hdr ? ` ${v.hdrScheme}` : ''}`,
        on: true,
        disabled: true,
      }] : [{ label: 'No video track', disabled: true }]),
    ]);
  },

  // ── network ────────────────────────────────────────────────────────────
  openNetwork() {
    const input = el('input', { type: 'text', placeholder: 'https://… / rtsp://… / udp://… / srt://…' });
    const help = el('div', { class: 'hint' },
      'Supported: HTTP, HTTPS, RTSP, RTMP, UDP, TCP, SRT, MMS and HLS/DASH manifests. ' +
      'Paste a direct .m3u8 or .mpd playlist and it will play too.');
    const m = this.modal({
      title: 'Open network stream',
      body: el('div', {}, el('div', { class: 'row' }, el('label', {}, 'URL'), el('div', { class: 'grow' }, input)), help),
      footer: [
        el('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'),
        el('button', {
          class: 'btn btn-primary',
          onclick: async () => {
            const url = input.value.trim();
            if (!url) return;
            m.close();
            await Player.playFiles([url]);
          },
        }, 'Play'),
      ],
    });
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        const url = input.value.trim();
        if (url) { m.close(); Player.playFiles([url]); }
      }
    };
    setTimeout(() => input.focus(), 40);
  },

  // ── media / codec information ──────────────────────────────────────────
  async openMediaInfo(pathArg) {
    const p = pathArg || State.path;
    if (!p) return;
    const info = (await window.apm.probe(p))[0];
    if (!info || !info.ok) return toast('Could not read this file', 'is-error');

    const kv = el('dl', { class: 'kv' });
    const add = (k, v) => { if (v) { kv.append(el('dt', {}, k), el('dd', {}, String(v))); } };
    add('File', info.path);
    add('Name', info.name);
    add('Type', info.kind);
    add('Container', info.formatLongName || info.container);
    add('Size', `${info.sizeHuman}${info.bitrate ? `  (${(info.bitrate / 1000).toFixed(0)} kbps)` : ''}`);
    add('Duration', info.durationHuman);

    const body = el('div', {}, kv);

    if (info.video) {
      body.append(el('div', { class: 'fmt-group', style: { marginTop: '18px' } },
        el('h4', {}, 'Video'),
        trackRow(`${info.video.codecName} (${info.video.codec})`,
          [info.video.profile, info.video.width ? `${info.video.width}×${info.video.height}` : null, info.video.fps ? `${info.video.fps} fps` : null,
           info.video.pixelFormat, info.video.hdr ? info.video.hdrScheme : null, info.video.bitrate ? `${(info.video.bitrate / 1000).toFixed(0)} kbps` : null].filter(Boolean).join('  •  '))));
    }

    if (info.audio?.length) {
      body.append(el('div', { class: 'fmt-group' }, el('h4', {}, `Audio (${info.audio.length})`),
        ...info.audio.map((a, i) => trackRow(`${i + 1}. ${a.codecName} (${a.codec})`,
          [a.language, a.channelLayout || `${a.channels} channels`, a.sampleRate ? `${a.sampleRate} Hz` : null,
           a.bitrate ? `${(a.bitrate / 1000).toFixed(0)} kbps` : null, a.title].filter(Boolean).join('  •  ')))));
    }

    if (info.subtitles?.length) {
      body.append(el('div', { class: 'fmt-group' }, el('h4', {}, `Subtitles (${info.subtitles.length})`),
        ...info.subtitles.map((s, i) => trackRow(`${i + 1}. ${s.codecName} (${s.codec})`,
          [s.language, s.forced ? 'forced' : null, s.title].filter(Boolean).join('  •  ')))));
    }

    if (info.chapters?.length) {
      body.append(el('div', { class: 'fmt-group' }, el('h4', {}, `Chapters (${info.chapters.length})`),
        el('div', { class: 'chips' }, ...info.chapters.map((c) => el('span', { class: 'chip' }, `${fmtTime(c.timeSec)} ${c.title}`)))));
    }

    this.modal({
      title: 'Media information',
      body,
      footer: [
        el('button', { class: 'btn', onclick: () => window.apm.reveal(info.path) }, 'Show in folder'),
        el('button', { class: 'btn btn-primary', onclick: () => this._modals[this._modals.length - 1].close() }, 'Close'),
      ],
    });
  },

  async openCodecInfo() {
    const report = await window.apm.formats();
    const body = el('div');
    body.append(el('p', { class: 'hint' },
      'APM Open Player decodes with libmpv, which embeds FFmpeg. That means one decoder set covers every container and codec below — including the lossless audio and surround formats that phones usually refuse to play.'));
    const info = await window.apm.info();
    body.append(el('div', { class: 'kv', style: { margin: '10px 0 18px' } },
      el('dt', {}, 'Engine'), el('dd', {}, info.mpvVersion || 'libmpv'),
      el('dt', {}, 'FFmpeg'), el('dd', {}, info.ffmpegVersion || 'bundled')));

    const group = (title, map) => {
      const names = Object.values(map).sort();
      return el('div', { class: 'fmt-group' }, el('h4', {}, `${title} (${names.length})`),
        el('div', { class: 'fmt-list' }, ...names.map((n) => el('span', {}, n))));
    };
    body.append(
      group('Video decoders', report.videoCodecs),
      group('Audio decoders', report.audioCodecs),
      group('Subtitle formats', report.subtitleCodecs),
      el('div', { class: 'fmt-group' }, el('h4', {}, 'Network protocols'),
        el('div', { class: 'fmt-list' }, ...['HTTP', 'HTTPS', 'RTSP', 'RTMP', 'RTMPS', 'UDP', 'TCP', 'SRT', 'MMS', 'FTP', 'HLS', 'DASH', 'RIST'].map((n) => el('span', {}, n)))),
    );

    this.modal({ title: 'Codec information', body, footer: [el('button', { class: 'btn btn-primary', onclick: () => this.closeTop() }, 'Close')], width: '900px' });
  },

  async openFormats() {
    const report = await window.apm.formats();
    const body = el('div');
    body.append(el('p', { class: 'hint' },
      'Everything below plays. If a file has an unusual extension, drag it in anyway — the decoder is chosen from the file contents, not the name.'));

    body.append(el('div', { class: 'fmt-group' }, el('h4', {}, `File extensions (${report.extensions.length})`),
      el('div', { class: 'fmt-list' }, ...report.extensions.map((e) => el('span', {}, `.${e}`)))));

    body.append(el('div', { class: 'fmt-group' }, el('h4', {}, 'Containers'),
      el('div', { class: 'fmt-list' }, ...report.videoContainers.map((c) => el('span', {}, `${c.name}  ${c.exts.map((e) => '.' + e).join(' ')}`)))));

    const group = (title, map) => el('div', { class: 'fmt-group' }, el('h4', {}, `${title} (${Object.keys(map).length})`),
      el('div', { class: 'fmt-list' }, ...Object.values(map).sort().map((n) => el('span', {}, n))));

    body.append(
      group('Video codecs', report.videoCodecs),
      group('Audio codecs', report.audioCodecs),
      group('Subtitle formats', report.subtitleCodecs),
      el('div', { class: 'fmt-group' }, el('h4', {}, 'Network'),
        el('div', { class: 'fmt-list' }, ...['http://', 'https://', 'rtsp://', 'rtmp://', 'rtmps://', 'udp://', 'tcp://', 'srt://', 'mms://', 'ftp://', 'HLS (.m3u8)', 'DASH (.mpd)'].map((n) => el('span', {}, n)))),
    );

    this.modal({ title: 'Supported formats', body, footer: [el('button', { class: 'btn btn-primary', onclick: () => this.closeTop() }, 'Close')], width: '900px' });
  },

  openShortcuts() {
    const groups = [
      ['Playback', [
        ['Play / Pause', 'Space'], ['Stop', 'S'], ['Next track', 'N or E'],
        ['Previous track', 'P'], ['Jump forward 10s', 'Right or Ctrl+→'],
        ['Jump back 10s', 'Left or Ctrl+←'], ['Jump forward 1 min', 'Ctrl+Shift+→'],
        ['Jump back 1 min', 'Ctrl+Shift+←'], ['Next chapter', 'Ctrl+Alt+→'],
        ['Faster', '+'], ['Slower', '-'], ['Normal speed', 'Ctrl+0'],
      ]],
      ['Audio', [
        ['Volume up / down', 'Up / Down or Ctrl+↑↓'], ['Mute', 'M'],
        ['Next audio track', 'B'], ['Audio device', 'Audio menu'],
      ]],
      ['Video', [
        ['Fullscreen', 'F or T'], ['Next video track', 'V'],
        ['Snapshot', 'Ctrl+Alt+S'], ['Snapshot with subtitles', 'Ctrl+Shift+Alt+S'],
      ]],
      ['Subtitles', [
        ['Add subtitle file', 'Ctrl+L'], ['Next subtitle track', 'J'],
        ['Subtitle delay -0.5s', 'H'], ['Subtitle delay +0.5s', 'K'],
      ]],
      ['Files', [
        ['Open file', 'Ctrl+O'], ['Open folder', 'Ctrl+F'],
        ['Open network stream', 'Ctrl+N'], ['Convert / Save', 'Ctrl+R'],
        ['Toggle sidebar', 'Ctrl+B'], ['Always on top', 'Ctrl+T'],
      ]],
      ['Other', [
        ['Effects and filters', 'Ctrl+E'], ['Media information', 'Ctrl+I or I'],
        ['Preferences', 'Ctrl+,'], ['Close dialog', 'Esc'],
      ]],
    ];
    const body = el('div');
    for (const [title, rows] of groups) {
      body.append(el('div', { class: 'fmt-group' }, el('h4', {}, title),
        el('table', { class: 'shortcut-table' }, el('tbody', {}, ...rows.map(([a, b]) =>
          el('tr', {}, el('td', {}, a), el('td', {}, ...b.split(' or ').map((k, i) => el('span', {}, i ? ' or ' : '', el('kbd', {}, k))))))))));
    }
    this.modal({ title: 'Keyboard shortcuts', body, footer: [el('button', { class: 'btn btn-primary', onclick: () => this.closeTop() }, 'Close')] });
  },

  async openAbout() {
    const info = await window.apm.info();
    const kv = el('dl', { class: 'kv' },
      el('dt', {}, 'Application'), el('dd', {}, `${info.name} ${info.version}`),
      el('dt', {}, 'Engine'), el('dd', {}, info.mpvVersion || 'libmpv'),
      el('dt', {}, 'FFmpeg'), el('dd', {}, info.ffmpegVersion || 'bundled'),
      el('dt', {}, 'Platform'), el('dd', {}, `${info.platform} ${info.arch}`),
      el('dt', {}, 'Source'), el('dd', {}, 'github.com/Abhijeet-Kumar-Prajapati/Open-Architecture-Power-Media-Player.--Software-Andriod-Mac-Os'));
    this.modal({
      title: 'About APM Open Player',
      body: el('div', {}, kv,
        el('p', { class: 'hint', style: { marginTop: '16px' } },
          'A universal media player that combines the best ideas from VLC, MX Player and KM Player into one open-source app: every format, every platform, no codec left behind.')),
      footer: [el('button', { class: 'btn btn-primary', onclick: () => this.closeTop() }, 'Close')],
    });
  },
};

// ===========================================================================
// Effects, converter and preferences
// ===========================================================================
Object.assign(Dialogs, {
  /** Video adjustments are applied live through mpv's filter chain. */
  openEffects(anchor) {
    if (anchor) {
      Dialogs.popover(anchor, [
        { title: 'Effects' },
        { label: 'Video effects…', onClick: () => Dialogs.openVideoEffects() },
        { label: 'Audio effects…', onClick: () => Dialogs.openAudioEffects() },
        { label: 'Equaliser', onClick: () => Dialogs.openEqualizer() },
        { sep: true },
        { label: 'Reset all', onClick: () => Dialogs.resetEffects() },
      ]);
      return;
    }
    Dialogs.openVideoEffects();
  },

  openVideoEffects() {
    const sliders = [
      ['Brightness', 'brightness', -100, 100, 0],
      ['Contrast', 'contrast', -100, 100, 0],
      ['Saturation', 'saturation', -100, 300, 0],
      ['Hue', 'hue', -180, 180, 0],
    ];
    const values = State.videoFx || { brightness: 0, contrast: 0, saturation: 0, hue: 0 };
    const body = el('div');

    body.append(el('div', { class: 'fmt-group' }, el('h4', {}, 'Picture adjustment'),
      ...sliders.map(([label, key, min, max, def]) => {
        const out = el('output', {}, String(Math.round(values[key] ?? def)));
        const input = el('input', {
          type: 'range', min, max, step: 1, value: String(values[key] ?? def),
          oninput: (e) => {
            const v = Number(e.target.value);
            out.textContent = String(v);
            State.videoFx = { ...(State.videoFx || {}), [key]: v };
            window.apm.command(key, { value: v });
          },
        });
        return el('div', { class: 'eq-row', style: { gridTemplateColumns: '90px 1fr 46px' } },
          el('label', {}, label), input, out);
      })));

    body.append(el('div', { class: 'fmt-group' }, el('h4', {}, 'Video processing'),
      ...this.selectRow('Hardware decoding', 'hwdec', values.hwdec || State.settings.hwdec || 'auto-safe', [
        ['auto-safe', 'Auto (safe)'], ['auto', 'Auto (aggressive)'],
        ['d3d11va', 'Direct3D 11 (Windows)'], ['nvdec', 'NVDEC (NVIDIA)'],
        ['qsv', 'Quick Sync (Intel)'], ['vaapi', 'VA-API (Linux/AMD)'],
        ['dxva2', 'DXVA2'], ['no', 'Software (no acceleration)'],
      ], (v) => {
        State.videoFx = { ...(State.videoFx || {}), hwdec: v };
        window.apm.command('hwdec', { value: v });
      }),
      this.selectRow('Deinterlace', 'deinterlace', values.deinterlace || 'auto', [
        ['auto', 'Auto'], ['no', 'Off'], ['yadif', 'YADIF (2x)'], ['yadif-double', 'YADIF double'], ['ivtc', 'IVTC (film)'],
      ], (v) => {
        State.videoFx = { ...(State.videoFx || {}), deinterlace: v };
        window.apm.command('property', { name: 'deinterlace', value: v });
      }),
      this.selectRow('Aspect ratio', 'aspect', values.aspect || 'default', [
        ['default', 'Default'], ['16:9', '16:9'], ['4:3', '4:3'], ['1:1', '1:1'], ['21:9', '21:9'], ['fill', 'Fill screen'],
      ], (v) => {
        State.videoFx = { ...(State.videoFx || {}), aspect: v };
        window.apm.command('property', { name: 'panscan', value: v === 'fill' ? '1' : '0' });
        window.apm.command('property', { name: 'keepaspect', value: v === 'fill' ? 'no' : 'yes' });
      })));

    Dialogs.modal({ title: 'Video effects', body, footer: [
      el('button', { class: 'btn', onclick: () => Dialogs.resetEffects() }, 'Reset'),
      el('button', { class: 'btn btn-primary', onclick: () => Dialogs.closeTop() }, 'Done'),
    ], width: '520px' });
  },

  openAudioEffects() {
    const values = State.audioFx || {};
    const body = el('div');
    body.append(el('div', { class: 'fmt-group' }, el('h4', {}, 'Output'),
      this.selectRow('Audio device', 'adevice', values.adevice || 'auto', [
        ['auto', 'System default'], ['wasapi', 'Windows Audio (WASAPI)'],
        ['pulse', 'PulseAudio (Linux)'], ['alsa', 'ALSA'], ['coreaudio', 'CoreAudio (macOS)'],
      ], (v) => { State.audioFx = { ...(State.audioFx || {}), adevice: v }; window.apm.command('audioDevice', { value: v }); }),
      this.selectRow('Stereo mode', 'stereo', values.stereo || 'normal', [
        ['normal', 'Normal'], ['headphones', 'Headphones'], ['surround', 'Surround'], ['mono', 'Mono'],
      ], (v) => {
        State.audioFx = { ...(State.audioFx || {}), stereo: v };
        const filter = v === 'headphones' ? 'af=headphone' : v === 'surround' ? 'af=stereotools=5.1' : v === 'mono' ? 'af=pan=mono|c0=c0' : '';
        Dialogs.applyAudioFilter(filter);
      }),
      this.selectRow('Sync mode', 'asynс', values.async || 'default', [
        ['default', 'Default'], ['audio', 'Sync to audio'], ['display', 'Sync to display'], ['framedrop', 'Frame drop'],
      ], (v) => { State.audioFx = { ...(State.audioFx || {}), async: v }; window.apm.command('audioSync', { mode: v }); })));

    body.append(el('div', { class: 'fmt-group' }, el('h4', {}, 'Pitch and tempo'),
      ...[['Pitch shift', -1200, 1200, 100, (v) => window.apm.command('audioFilter', { value: `af=asetrate=${48000 * (1 + v / 1200)},aresample=48000` })],
          ['Tempo change', 0.5, 2.0, 0.01, (v) => window.apm.command('audioFilter', { value: `af=atempo=${v}` })]]
        .map(([label, min, max, step, apply]) => {
          const out = el('output', {}, String(values[label] ?? (label === 'Pitch shift' ? 100 : 1)));
          return el('div', { class: 'eq-row', style: { gridTemplateColumns: '90px 1fr 46px' } },
            el('label', {}, label),
            el('input', { type: 'range', min, max, step, value: String(values[label] ?? (label === 'Pitch shift' ? 100 : 1)),
              oninput: (e) => { const v = Number(e.target.value); out.textContent = String(v); State.audioFx = { ...(State.audioFx || {}), [label]: v }; apply(v); } }),
            out);
        })));

    Dialogs.modal({ title: 'Audio effects', body, footer: [
      el('button', { class: 'btn', onclick: () => Dialogs.applyAudioFilter('') }, 'Reset'),
      el('button', { class: 'btn btn-primary', onclick: () => Dialogs.closeTop() }, 'Done'),
    ], width: '520px' });
  },

  /** mpv's `af=equalizer` takes 10 comma-separated gains in dB, low band first. */
  openEqualizer() {
    const BANDS = [60, 170, 600, 1000, 3000, 6000, 12000, 14000, 16000, 18000];
    const PRESETS = {
      Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      'Rock': [6, 5, 3, 1, -1, -2, -3, -3, -2, -2],
      Pop: [-1, 2, 4, 5, 3, 0, -1, -1, -1, -1],
      Jazz: [4, 3, 1, 2, -1, -1, 0, 1, 2, 3],
      Classical: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4],
      Bass: [8, 7, 5, 2, 0, 0, 0, 0, 0, 0],
      Treble: [0, 0, 0, 1, 3, 5, 7, 8, 8, 8],
      Vocal: [-3, -2, 0, 3, 5, 4, 2, 0, -1, -2],
    };

    let gains = (State.settings.equalizer && State.settings.equalizer.gains) || PRESETS.Flat.slice();
    let enabled = State.settings.equalizer ? State.settings.equalizer.enabled !== false : false;
    const preview = el('div', { class: 'chips' });
    const rows = el('div');

    const apply = () => {
      const filter = enabled ? `af=equalizer=f=${BANDS.join('|')}:c=${gains.map((g) => g.toFixed(1)).join('|')}` : '';
      Dialogs.applyAudioFilter(filter);
      window.apm.settings.set({ equalizer: { enabled, gains } });
    };

    const buildRows = () => {
      rows.innerHTML = '';
      BANDS.forEach((hz, i) => {
        const out = el('output', {}, `${gains[i] > 0 ? '+' : ''}${gains[i].toFixed(1)} dB`);
        rows.append(el('div', { class: 'eq-row' },
          el('label', {}, hz >= 1000 ? `${hz / 1000}k` : hz),
          el('input', { type: 'range', min: -20, max: 20, step: 0.5, value: String(gains[i]),
            oninput: (e) => { gains[i] = Number(e.target.value); out.textContent = `${gains[i] > 0 ? '+' : ''}${gains[i].toFixed(1)} dB`; apply(); } }),
          out));
      });
    };

    const presetChips = el('div', { class: 'chips' },
      ...Object.entries(PRESETS).map(([name, vals]) => el('button', {
        class: 'btn btn-sm', onclick: () => { gains = vals.slice(); buildRows(); apply(); },
      }, name)));

    preview.append(presetChips);

    const toggle = el('div', { class: `switch${enabled ? ' is-on' : ''}` });
    toggle.onclick = () => {
      enabled = !enabled;
      toggle.classList.toggle('is-on', enabled);
      apply();
    };

    buildRows();

    const body = el('div', {},
      el('div', { class: 'row' }, el('label', {}, 'Enable equaliser'), el('div', { class: 'grow' }, toggle)),
      el('div', { class: 'fmt-group' }, el('h4', {}, 'Presets'), presetChips),
      el('div', { class: 'fmt-group' }, el('h4', {}, 'Bands'), rows));

    Dialogs.modal({ title: 'Equaliser', body, footer: [
      el('button', { class: 'btn', onclick: () => { gains = PRESETS.Flat.slice(); enabled = false; toggle.classList.remove('is-on'); buildRows(); apply(); } }, 'Reset'),
      el('button', { class: 'btn btn-primary', onclick: () => Dialogs.closeTop() }, 'Done'),
    ], width: '520px' });
  },

  applyAudioFilter(filter) {
    window.apm.command('audioFilter', { value: filter });
  },

  resetEffects() {
    for (const k of ['brightness', 'contrast', 'saturation', 'hue']) window.apm.command(k, { value: 0 });
    Dialogs.applyAudioFilter('');
    State.videoFx = {};
    State.audioFx = {};
    toast('Effects reset');
  },

  /** A label + <select> row, wired to a callback. */
  selectRow(label, key, value, options, onChange) {
    const sel = el('select', { onchange: (e) => onChange(e.target.value) },
      ...options.map(([v, text]) => el('option', { value: v, selected: String(v) === String(value) }, text)));
    return el('div', { class: 'row' }, el('label', {}, label), el('div', { class: 'grow' }, sel));
  },

  // ── converter ──────────────────────────────────────────────────────────
  async openConverter() {
    let presets;
    try {
      presets = await window.apm.convert.presets();
    } catch (err) {
      return toast(`Converter unavailable: ${err.message}`, 'is-error', 6000);
    }

    const source = State.path;
    if (!source) return toast('Open a file first, then convert it', 'is-error');

    const info = State.info || {};
    let presetId = 'mp4-h264';
    let outPath = null;
    let jobId = null;
    let cancelled = false;

    const progress = el('div', { class: 'progress' }, el('div'));
    const status = el('div', { class: 'hint' }, `${info.name}  •  ${info.sizeHuman || ''}  •  ${info.durationHuman || ''}`);
    const startBtn = el('button', { class: 'btn btn-primary', disabled: !outPath }, 'Start conversion');
    const chooseBtn = el('button', { class: 'btn' }, 'Choose output file…');

    const select = el('select', { onchange: (e) => { presetId = e.target.value; } },
      ...presets.map((p) => el('option', { value: p.id, selected: p.id === presetId }, p.name)));

    const hint = el('div', { class: 'hint' }, presets.find((p) => p.id === presetId)?.hint || '');
    select.onchange = (e) => {
      presetId = e.target.value;
      hint.textContent = presets.find((p) => p.id === presetId)?.hint || '';
    };

    const body = el('div', {},
      el('div', { class: 'fmt-group' }, el('h4', {}, 'Source'), status),
      el('div', { class: 'fmt-group' }, el('h4', {}, 'Preset'), select, hint),
      el('div', { class: 'fmt-group' }, el('h4', {}, 'Output'), el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
        el('div', { class: 'grow', style: { fontSize: '12.5px', color: 'var(--text-faint)' } }, 'No output file chosen'),
        chooseBtn)),
      el('div', { class: 'fmt-group' }, el('h4', {}, 'Progress'), progress, el('div', { class: 'hint' }, 'Ready.')));

    const m = Dialogs.modal({ title: 'Convert / Save', body, footer: [
      el('button', { class: 'btn btn-danger', style: { display: 'none' }, onclick: () => { window.apm.convert.cancel(jobId); cancelled = true; } }, 'Cancel job'),
      chooseBtnClone(chooseBtn),
      startBtn,
    ], width: '620px' });

    function chooseBtnClone() { return null; }

    chooseBtn.onclick = async () => {
      const p = await window.apm.convert.pickOutput({ input: source, presetId });
      if (!p) return;
      outPath = p;
      startBtn.disabled = false;
      const label = body.querySelector('.fmt-group:nth-child(3) .grow');
      if (label) label.textContent = p;
    };

    const cancelBtn = m.el.querySelector('.btn-danger');
    cancelBtn.style.display = 'none';
    const startBtn2 = startBtn;

    startBtn2.onclick = async () => {
      startBtn2.disabled = true;
      chooseBtn.disabled = true;
      cancelBtn.style.display = '';
      cancelled = false;
      const res = await window.apm.convert.start({
        input: source,
        output: outPath,
        presetId,
        durationSec: info.durationSec || 0,
      });
      jobId = res.id;
    };

    window.apm.on('convert:progress', (p) => {
      if (p.id !== jobId) return;
      if (p.percent != null) progress.firstChild.style.width = `${p.percent.toFixed(1)}%`;
      else progress.firstChild.style.width = '20%';
      hint.textContent = `${p.message || 'Working'} — ${(p.seconds || 0).toFixed(0)}s`;
    });

    window.apm.on('convert:done', (r) => {
      if (r.id !== jobId) return;
      if (cancelled) { toast('Conversion cancelled'); return; }
      if (r.ok) toast(`Converted: ${r.output}`, 'is-good', 6000);
      else toast(`Conversion failed: ${r.error}`, 'is-error', 8000);
      startBtn2.disabled = false;
      chooseBtn.disabled = false;
      cancelBtn.style.display = 'none';
    });
  },

  // ── preferences ────────────────────────────────────────────────────────
  async openPreferences() {
    const s = await window.apm.settings.get();

    const numRow = (label, key, min, max, step = 1, hint) => {
      const input = el('input', { type: 'number', min, max, step, value: String(s[key]),
        onchange: (e) => { s[key] = Number(e.target.value); window.apm.settings.set({ [key]: s[key] }); } });
      return el('div', { class: 'row' }, el('label', {}, label),
        el('div', { class: 'grow' }, input, hint ? el('div', { class: 'hint' }, hint) : null));
    };

    const boolRow = (label, key, hint) => {
      const sw = el('div', { class: `switch${s[key] ? ' is-on' : ''}` });
      sw.onclick = () => {
        s[key] = !s[key];
        sw.classList.toggle('is-on', s[key]);
        window.apm.settings.set({ [key]: s[key] });
      };
      return el('div', { class: 'row' }, el('label', {}, label), el('div', { class: 'grow' }, sw, hint ? el('div', { class: 'hint' }, hint) : null));
    };

    const subtitleTab = () => el('div', {},
      this.selectRow('Font', 'font', s.subtitleStyle.font || '', [
        ['', 'Default (libass picks)'], ['Arial', 'Arial'], ['Tahoma', 'Tahoma'], ['Verdana', 'Verdana'],
        ['Calibri', 'Calibri'], ['Courier New', 'Courier New'], ['Noto Sans', 'Noto Sans'],
      ], (v) => { s.subtitleStyle = { ...s.subtitleStyle, font: v }; window.apm.command('subtitleStyle', { font: v }); }),

      this.colorRow('Text colour', s.subtitleStyle.color || '#ffffff', (v) => { s.subtitleStyle = { ...s.subtitleStyle, color: v }; window.apm.command('subtitleStyle', { color: v.replace('#', '#') }); }),

      (() => {
        const out = el('output', {}, `${s.subtitleStyle.size || 32} px`);
        return el('div', { class: 'row' }, el('label', {}, 'Size'),
          el('div', { class: 'grow' },
            el('input', { type: 'range', min: 12, max: 96, step: 1, value: String(s.subtitleStyle.size || 32),
              oninput: (e) => { out.textContent = `${e.target.value} px`; s.subtitleStyle = { ...s.subtitleStyle, size: Number(e.target.value) }; window.apm.command('subtitleStyle', { size: e.target.value }); } }),
            out));
      })(),

      (() => {
        const out = el('output', {}, `${s.subtitleStyle.outline ?? 2} px`);
        return el('div', { class: 'row' }, el('label', {}, 'Outline'),
          el('div', { class: 'grow' },
            el('input', { type: 'range', min: 0, max: 8, step: 0.5, value: String(s.subtitleStyle.outline ?? 2),
              oninput: (e) => { out.textContent = `${e.target.value} px`; s.subtitleStyle = { ...s.subtitleStyle, outline: Number(e.target.value) }; window.apm.command('subtitleStyle', { outline: Number(e.target.value) }); } }),
            out));
      })(),

      (() => {
        const sw = el('div', { class: `switch${s.subtitleStyle.bold ? ' is-on' : ''}` });
        sw.onclick = () => { const v = !sw.classList.contains('is-on'); sw.classList.toggle('is-on', v); s.subtitleStyle = { ...s.subtitleStyle, bold: v }; window.apm.command('subtitleStyle', { bold: v }); };
        return el('div', { class: 'row' }, el('label', {}, 'Bold'), el('div', { class: 'grow' }, sw));
      })(),

      (() => {
        const sw = el('div', { class: `switch${s.subtitleStyle.shadow ? ' is-on' : ''}` });
        sw.onclick = () => { const v = !sw.classList.contains('is-on'); sw.classList.toggle('is-on', v); s.subtitleStyle = { ...s.subtitleStyle, shadow: v }; window.apm.command('subtitleStyle', { shadow: v }); };
        return el('div', { class: 'row' }, el('label', {}, 'Shadow'), el('div', { class: 'grow' }, sw));
      })(),

      el('div', { class: 'row' }, el('label', {}, 'Force subtitle position'),
        el('div', { class: 'grow' },
          el('input', { type: 'number', min: 0, max: 150, value: '0', step: 5,
            onchange: (e) => window.apm.command('property', { name: 'sub-align-y', value: e.target.value }) }),
          el('div', { class: 'hint' }, 'Percent from the bottom. 0 keeps the position from the subtitle file.'))),

      boolRow('Load subtitles found next to the video automatically', 'subAuto', 'Looks for matching .srt/.ass files beside the media file.'),
    );

    const tabs = [
      { name: 'Interface', render: () => el('div', {},
        boolRow('Show the sidebar', 'sidebarVisible'),
        boolRow('Remember window size and position', 'rememberWindow'),
        boolRow('Confirm before closing', 'confirmOnQuit'),
        this.selectRow('Theme', 'theme', s.theme || 'dark', [['dark', 'Dark'], ['light', 'Light'], ['system', 'Follow system']], (v) => {
          s.theme = v;
          window.apm.settings.set({ theme: v });
        }),
        el('div', { class: 'fmt-group' }, el('h4', {}, 'Library folders'),
          el('div', { class: 'hint' }, (s.watchFolders || []).length
            ? s.watchFolders.map((f) => f.path).join('\n')
            : 'No folders watched yet. Use Tools ▸ Add Folder to Library.'),
          el('button', { class: 'btn btn-sm', style: { marginTop: '8px' }, onclick: () => window.APMApp.addWatchFolder() }, 'Add folder')),
      ) },
      { name: 'Playback', render: () => el('div', {},
        numRow('Seek forward', 'jumpForward', 1, 600, 1, 'Seconds for the → key'),
        numRow('Seek backward', 'jumpBackward', 1, 600, 1, 'Seconds for the ← key'),
        numRow('Long seek forward', 'jumpLongForward', 5, 1800, 5, 'Seconds for Ctrl+Shift+→'),
        numRow('Long seek backward', 'jumpLongBackward', 5, 1800, 5, 'Seconds for Ctrl+Shift+←'),
        boolRow('Resume playback where it stopped', 'resumePlayback', 'Remembers the position of each file.'),
        this.selectRow('Hardware decoding', 'hwdec', s.hwdec || 'auto-safe', [
          ['auto-safe', 'Auto (safe)'], ['auto', 'Auto (aggressive)'], ['d3d11va', 'Direct3D 11'], ['nvdec', 'NVDEC'], ['qsv', 'Quick Sync'], ['vaapi', 'VA-API'], ['no', 'Disabled'],
        ], (v) => { s.hwdec = v; window.apm.settings.set({ hwdec: v }); window.apm.command('hwdec', { value: v }); }),
      ) },
      { name: 'Subtitles', render: subtitleTab },
      { name: 'Network', render: () => el('div', {},
        el('div', { class: 'hint' }, 'APM streams over plain HTTP without special configuration. If a server needs credentials you can paste them in the URL.'),
        numRow('Network timeout', 'networkTimeout', 5, 300, 5, 'Seconds before a stalled stream is considered dead'),
        boolRow('Tune the network cache for streaming', 'networkCache', 'Keeps more data buffered for smooth playback on slow connections.'),
      ) },
    ];

    Dialogs.tabbedModal('Preferences', tabs);
  },

  colorRow(label, value, onChange) {
    return el('div', { class: 'row' }, el('label', {}, label),
      el('div', { class: 'grow' }, el('input', { type: 'color', value, oninput: (e) => onChange(e.target.value) })));
  },

  /** Shown when libmpv could not be loaded - almost always a missing engine. */
  engineMissing(detail) {
    Dialogs.modal({
      title: 'Playback engine not found',
      body: el('div', {},
        el('p', { style: { marginBottom: '12px' } },
          'APM Open Player uses the mpv engine to decode every format. It could not be loaded, ' +
          'so nothing can play yet.'),
        el('pre', {
          style: {
            whiteSpace: 'pre-wrap', fontSize: '12px', lineHeight: '1.6', color: 'var(--text-dim)',
            background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: '8px',
            padding: '12px', fontFamily: 'ui-monospace, Consolas, monospace',
          },
        }, detail || ''),
      ),
      footer: [el('button', { class: 'btn btn-primary', onclick: () => Dialogs.closeTop() }, 'Close')],
    });
  },
});

function trackRow(title, sub) {
  return el('div', { class: 'track-row' },
    el('div', { class: 'tr-main' },
      el('div', { class: 'tr-title' }, title),
      sub ? el('div', { class: 'tr-sub' }, sub) : null));
}

window.APMDialogs = Dialogs;
})();
