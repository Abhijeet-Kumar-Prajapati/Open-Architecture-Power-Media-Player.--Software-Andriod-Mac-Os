'use strict';
/**
 * Open/save dialog filters. This is the app's promise to the user in file
 * picker form: "we open everything", expressed as extensions we can actually
 * hand to libmpv. Anything not listed still opens by drag-and-drop or the
 * Open dialog's "All files" entry - the list is a convenience, not a gate.
 */

const SUPPORTED_EXTENSIONS = [
  // video containers
  'mp4', 'm4v', 'mkv', 'webm', 'avi', 'mov', 'qt', 'wmv', 'asf', 'flv', 'f4v',
  'ts', 'm2ts', 'mts', 'm2v', 'vob', 'ogv', '3gp', '3g2', 'mpg', 'mpeg', 'mpe',
  'm1v', 'rm', 'rmvb', 'divx', 'mxf', 'dv', 'nsv', 'swf', 'amv', 'tp', 'trp',
  'dvr-ms', 'roq', 'y4m', 'gif', 'mjpeg',
  // audio containers + codecs
  'mp3', 'aac', 'm4a', 'm4b', 'flac', 'wav', 'wave', 'ogg', 'oga', 'opus', 'spx',
  'wma', 'aiff', 'aif', 'aifc', 'ape', 'wv', 'tta', 'tak', 'dts', 'ac3', 'eac3',
  'ec3', 'mka', 'amr', 'awb', 'caf', 'dsf', 'dff', 'ra', 'ram', 'au', 'snd',
  'mpc', 'voc', 'mid', 'midi', 'kar', 'mod', 's3m', 'xm', 'it',
  // subtitles
  'srt', 'ass', 'ssa', 'sub', 'idx', 'vtt', 'smi', 'sami', 'mpl',
  // playlists
  'm3u', 'm3u8', 'pls', 'cue', 'asx', 'wax', 'wvx',
];

const SUPPORTED_FILTERS = [
  {
    name: 'All supported media',
    extensions: SUPPORTED_EXTENSIONS,
  },
  {
    name: 'Video files',
    extensions: [
      'mp4', 'm4v', 'mkv', 'webm', 'avi', 'mov', 'qt', 'wmv', 'asf', 'flv',
      'f4v', 'ts', 'm2ts', 'mts', 'm2v', 'vob', 'ogv', '3gp', '3g2', 'mpg',
      'mpeg', 'mpe', 'm1v', 'rm', 'rmvb', 'divx', 'mxf', 'dv', 'nsv', 'swf',
      'amv', 'tp', 'trp', 'dvr-ms', 'roq', 'y4m', 'gif', 'mjpeg',
    ],
  },
  {
    name: 'Audio files',
    extensions: [
      'mp3', 'aac', 'm4a', 'm4b', 'flac', 'wav', 'wave', 'ogg', 'oga', 'opus',
      'spx', 'wma', 'aiff', 'aif', 'aifc', 'ape', 'wv', 'tta', 'tak', 'dts',
      'ac3', 'eac3', 'ec3', 'mka', 'amr', 'awb', 'caf', 'dsf', 'dff', 'ra',
      'ram', 'au', 'snd', 'mpc', 'voc', 'mid', 'midi', 'kar', 'mod', 's3m',
      'xm', 'it',
    ],
  },
  { name: 'Subtitle files', extensions: ['srt', 'ass', 'ssa', 'sub', 'idx', 'vtt', 'smi', 'sami', 'mpl'] },
  { name: 'Playlists', extensions: ['m3u', 'm3u8', 'pls', 'cue', 'asx', 'wax', 'wvx'] },
  { name: 'Network streams', extensions: ['url', 'm3u', 'm3u8', 'mpd'] },
  { name: 'All files', extensions: ['*'] },
];

module.exports = { SUPPORTED_FILTERS, SUPPORTED_EXTENSIONS };