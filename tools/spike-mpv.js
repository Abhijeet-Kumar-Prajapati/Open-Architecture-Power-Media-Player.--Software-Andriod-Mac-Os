/**
 * Spike: verify koffi can drive libmpv and that the FFmpeg build reports the
 * expected codec support. Run: node tools/spike-mpv.js
 */
const path = require('path');
// koffi is a desktop dependency, so it installs into desktop/node_modules
// and plain require() from tools/ cannot reach a sibling folder.
const koffi = require(path.resolve(__dirname, '..', 'desktop', 'node_modules', 'koffi'));
const { MpvEngine } = require('../desktop/src/main/mpv-engine');

(async () => {
  const dll = path.join(__dirname, '..', 'desktop', 'vendor', 'mpv', 'libmpv-2.dll');
  console.log('loading', dll);
  const t0 = Date.now();
  const raw = koffi.load(dll);
  console.log('  loaded in', Date.now() - t0, 'ms');
  const ver = raw.func('uint64_t __cdecl mpv_client_api_version()')();
  const hex = BigInt(ver).toString(16);
  console.log('  mpv client API version:', hex, `(${(ver >> 16) & 0xff}.${(ver >> 8) & 0xff}.${ver & 0xff})`);

  const engine = new MpvEngine({ dllPath: dll });
  engine.init();
  console.log('  mpv_initialize OK');
  console.log('  mpv version:', engine.getString('mpv-version'));
  console.log('  ffmpeg:', engine.getString('ffmpeg-version'));

  // Which demuxers/decoders did this build actually compile in?
  const decoders = engine.getString('decoder-list') || '';
  const demuxers = engine.getString('demuxer-list') || '';
  const encoders = engine.getString('encoder-list') || '';
  const protocolList = engine.getString('protocol-list') || '';

  const want = [
    ['h264', decoders], ['hevc', decoders], ['av1', decoders], ['vp9', decoders],
    ['mpeg2video', decoders], ['vc1', decoders], ['prores', decoders], ['wmv3', decoders],
    ['theora', decoders], ['ffv1', decoders],
    ['aac', decoders], ['mp3', decoders], ['flac', decoders], ['opus', decoders],
    ['vorbis', decoders], ['eac3', decoders], ['ac3', decoders], ['truehd', decoders],
    ['dts', decoders], ['dts-hd', decoders], ['alac', decoders], ['ape', decoders],
    ['wv', decoders], ['tta', decoders], ['mlp', decoders],
    ['matroska', demuxers], ['avi', demuxers], ['mov', demuxers], ['mp4', demuxers],
    ['mpegts', demuxers], ['flv', demuxers], ['asf', demuxers], ['rm', demuxers],
    ['concat', demuxers], ['image2', demuxers], ['hls', demuxers], ['dash', demuxers],
    ['rtsp', protocolList], ['rtmp', protocolList], ['http', protocolList],
    ['srt', protocolList], ['udp', protocolList], ['mms', protocolList],
  ];
  let missing = [];
  for (const [name, hay] of want) {
    const ok = String(hay).includes(name);
    if (!ok) missing.push(name);
    process.stdout.write(`${ok ? '  ok  ' : '  MISS'} ${name}\n`);
  }
  console.log('\nmissing:', missing.length ? missing.join(', ') : 'none');
  console.log('total decoders:', decoders.split(',').filter(Boolean).length);
  console.log('total demuxers:', demuxers.split(',').filter(Boolean).length);
  console.log('total protocols:', protocolList.split(',').filter(Boolean).length);
  engine.destroy();
  console.log('DONE');
  process.exit(0);
})().catch((e) => {
  console.error('SPIKE FAILED:', e);
  process.exit(1);
});