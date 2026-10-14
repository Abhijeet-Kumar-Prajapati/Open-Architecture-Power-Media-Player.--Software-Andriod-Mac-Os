'use strict';
/**
 * Application menu. Kept deliberately close to VLC's layout so muscle memory
 * from any other player carries over.
 */

const { Menu, shell, app, dialog } = require('electron');
const path = require('path');

function send(renderer, channel, payload) {
  const wc = renderer && renderer();
  if (wc && !wc.isDestroyed()) wc.send(channel, payload);
}

function buildMenu(deps) {
  const isMac = process.platform === 'darwin';
  const cmds = (name, args) => {
    deps.renderer() && deps.renderer().send('menu:command', { name, args: args || {} });
  };

  const template = [
    ...(isMac
      ? [
          {
            label: app.getName(),
            submenu: [
              { role: 'about', label: `About ${app.getName()}` },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: '&File',
      submenu: [
        { label: 'Open File...', accelerator: 'CmdOrCtrl+O', click: () => deps.openFiles() },
        { label: 'Open Multiple Files...', accelerator: 'CmdOrCtrl+Shift+O', click: () => cmds('openMultiple') },
        { label: 'Open Folder...', accelerator: 'CmdOrCtrl+F', click: () => deps.openFolderDialog() },
        { label: 'Open Disc...', click: () => cmds('openDisc') },
        { type: 'separator' },
        { label: 'Open Network Stream...', accelerator: 'CmdOrCtrl+N', click: () => cmds('openNetwork') },
        { label: 'Open Clipboard URL', click: () => cmds('openClipboardUrl') },
        { type: 'separator' },
        { label: 'Save Playlist...', accelerator: 'CmdOrCtrl+Y', click: () => cmds('savePlaylist') },
        { label: 'Convert / Save...', accelerator: 'CmdOrCtrl+R', click: () => cmds('openConverter') },
        { type: 'separator' },
        ...(isMac ? [{ role: 'close' }] : [
          { label: 'Close', accelerator: 'Ctrl+W', click: () => deps.getWindow().close() },
          {
            label: 'Exit',
            accelerator: 'Alt+F4',
            click: () => deps.quit(),
          },
        ]),
      ],
    },
    {
      label: '&Playback',
      submenu: [
        { label: 'Play', accelerator: 'Space', click: () => cmds('togglePause') },
        { label: 'Stop', accelerator: 'CmdOrCtrl+.', click: () => cmds('stop') },
        { type: 'separator' },
        { label: 'Next', accelerator: 'Media Next Track', click: () => cmds('next') },
        { label: 'Previous', accelerator: 'Media Previous Track', click: () => cmds('prev') },
        { type: 'separator' },
        { label: 'Faster', accelerator: 'CmdOrCtrl+=', click: () => cmds('speedUp') },
        { label: 'Slower', accelerator: 'CmdOrCtrl+-', click: () => cmds('speedDown') },
        { label: 'Normal Speed', accelerator: 'CmdOrCtrl+0', click: () => cmds('speedReset') },
        { type: 'separator' },
        { label: 'Jump Forward 10s', accelerator: 'CmdOrCtrl+Right', click: () => cmds('jumpForward') },
        { label: 'Jump Backward 10s', accelerator: 'CmdOrCtrl+Left', click: () => cmds('jumpBackward') },
        { label: 'Jump Forward 1min', accelerator: 'CmdOrCtrl+Shift+Right', click: () => cmds('jumpLongForward') },
        { label: 'Jump Backward 1min', accelerator: 'CmdOrCtrl+Shift+Left', click: () => cmds('jumpLongBackward') },
        { label: 'Next Chapter', accelerator: 'CmdOrCtrl+Alt+Right', click: () => cmds('nextChapter') },
        { label: 'Previous Chapter', accelerator: 'CmdOrCtrl+Alt+Left', click: () => cmds('prevChapter') },
        { type: 'separator' },
        { label: 'Record', accelerator: 'CmdOrCtrl+R'.replace('CmdOrCtrl+R', 'Shift+CmdOrCtrl+R'), click: () => cmds('record') },
      ],
    },
    {
      label: '&Audio',
      submenu: [
        { label: 'Increase Volume', accelerator: 'CmdOrCtrl+Up', click: () => cmds('volumeUp') },
        { label: 'Decrease Volume', accelerator: 'CmdOrCtrl+Down', click: () => cmds('volumeDown') },
        { label: 'Mute', accelerator: 'M', click: () => cmds('muteToggle') },
        { type: 'separator' },
        { label: 'Next Audio Track', accelerator: 'B', click: () => cmds('nextAudioTrack') },
        { label: 'Audio Device...', click: () => cmds('audioDevices') },
        { type: 'separator' },
        {
          label: 'Stereo Mode',
          submenu: [
            { label: 'Normal', click: () => cmds('audioStereo', { mode: 'normal' }) },
            { label: 'Headphones', click: () => cmds('audioStereo', { mode: 'headphones' }) },
            { label: 'Surround', click: () => cmds('audioStereo', { mode: 'surround' }) },
          ],
        },
        {
          label: 'Visualizations',
          submenu: [
            { label: 'Disable', click: () => cmds('visual', { mode: 'none' }) },
            { label: 'Spectrum', click: () => cmds('visual', { mode: 'spectrum' }) },
            { label: 'Scope', click: () => cmds('visual', { mode: 'scope' }) },
            { label: 'VU Meter', click: () => cmds('visual', { mode: 'vu' }) },
            { label: 'Waves', click: () => cmds('visual', { mode: 'waves' }) },
          ],
        },
        {
          label: 'Equalizer',
          submenu: [
            { label: 'Enable', type: 'checkbox', click: (item) => cmds('equalizerEnable', { on: item.checked }) },
            { type: 'separator' },
            { label: 'Reset', click: () => cmds('equalizerReset') },
          ],
        },
        { label: 'Audio Effects...', click: () => cmds('openAudioEffects') },
      ],
    },
    {
      label: '&Video',
      submenu: [
        { label: 'Fullscreen', accelerator: 'F', click: () => deps.toggleFullscreen() },
        { label: 'Always on Top', accelerator: 'CmdOrCtrl+T', click: () => cmds('toggleAlwaysOnTop') },
        { type: 'separator' },
        { label: 'Next Video Track', accelerator: 'V', click: () => cmds('nextVideoTrack') },
        { label: 'Video Device...', click: () => cmds('videoDevices') },
        { type: 'separator' },
        {
          label: 'Aspect Ratio',
          submenu: ['Default', '16:9', '4:3', '1:1', '21:9', 'Fill', 'Crop'].map((label) => ({
            label,
            click: () => cmds('aspect', { mode: label }),
          })),
        },
        {
          label: 'Crop',
          submenu: ['Default', '16:9', '16:10', '2.35:1', '1:1'].map((label) => ({
            label,
            click: () => cmds('crop', { mode: label }),
          })),
        },
        {
          label: 'Deinterlace',
          submenu: [
            { label: 'Off', click: () => cmds('deinterlace', { mode: 'no' }) },
            { label: 'Auto', click: () => cmds('deinterlace', { mode: 'auto' }) },
            { label: 'On', click: () => cmds('deinterlace', { mode: 'yes' }) },
          ],
        },
        { type: 'separator' },
        { label: 'Take Snapshot', accelerator: 'CmdOrCtrl+Alt+S', click: () => cmds('screenshot') },
        { label: 'Take Snapshot (with subtitles)', accelerator: 'Shift+CmdOrCtrl+Alt+S', click: () => cmds('screenshotSubtitles') },
        { type: 'separator' },
        { label: 'Video Effects...', click: () => cmds('openVideoEffects') },
      ],
    },
    {
      label: '&Subtitle',
      submenu: [
        { label: 'Add Subtitle File...', accelerator: 'CmdOrCtrl+L', click: () => cmds('addSubtitle') },
        { label: 'Sub Track', submenu: [{ label: 'Next Subtitle Track', accelerator: 'N', click: () => cmds('nextSubTrack') }] },
        { type: 'separator' },
        { label: 'Subtitle Delay', submenu: [
          { label: 'Subtitle Delay -0.5s', accelerator: 'Shift+H', click: () => cmds('subDelay', { by: -0.5 }) },
          { label: 'Subtitle Delay +0.5s', accelerator: 'Shift+J', click: () => cmds('subDelay', { by: 0.5 }) },
        ] },
        { type: 'separator' },
        { label: 'Subtitle Settings...', click: () => cmds('openSubtitleSettings') },
      ],
    },
    {
      label: '&Tools',
      submenu: [
        { label: 'Effects and Filters...', accelerator: 'CmdOrCtrl+E', click: () => cmds('openEffects') },
        { label: 'Media Information', accelerator: 'CmdOrCtrl+I', click: () => cmds('openMediaInfo') },
        { label: 'Codec Information', accelerator: 'CmdOrCtrl+J', click: () => cmds('openCodecInfo') },
        { type: 'separator' },
        { label: 'Media Library', accelerator: 'CmdOrCtrl+Shift+L', click: () => cmds('openLibrary') },
        { label: 'Playlist', accelerator: 'CmdOrCtrl+L'.replace('CmdOrCtrl+L', 'CmdOrCtrl+P'), click: () => cmds('togglePlaylist') },
        { label: 'Add Folder to Library...', click: () => cmds('addWatchFolder') },
        { type: 'separator' },
        { label: 'Preferences', accelerator: 'CmdOrCtrl+,', click: () => cmds('openPreferences') },
        { type: 'separator' },
        { label: 'Take Snapshot Folder', click: () => shell.openPath(path.join(app.getPath('pictures'))) },
      ],
    },
    {
      label: '&Help',
      submenu: [
        { label: 'Supported Formats', click: () => cmds('openFormats') },
        { label: 'Keyboard Shortcuts', accelerator: 'CmdOrCtrl+Shift+H', click: () => cmds('openShortcuts') },
        { type: 'separator' },
        { label: 'Project Page', click: () => shell.openExternal('https://github.com/Abhijeet-Kumar-Prajapati/Open-Architecture-Power-Media-Player.--Software-Andriod-Mac-Os') },
        { label: 'Report an Issue', click: () => shell.openExternal('https://github.com/Abhijeet-Kumar-Prajapati/Open-Architecture-Power-Media-Player.--Software-Andriod-Mac-Os/issues') },
        { type: 'separator' },
        { label: `About ${app.getName()}`, click: () => cmds('openAbout') },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  return menu;
}

module.exports = { buildMenu };