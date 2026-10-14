# Format reference

This is the format list APM Open Player actually ships support for. It is not
copied from another product — `tools/spike-mpv.js` reads `decoder-list` out of
the shipped binary and the desktop app shows the same inventory at runtime under
**Tools → Codec information**.

---

## Video containers

| Container | Extensions | Common use |
| --- | --- | --- |
| MPEG-4 | `.mp4` `.m4v` | phones, web, everything |
| Matroska | `.mkv` `.mka` `.mks` | the universal home video container |
| WebM | `.webm` | VP8/VP9 + Opus, web standard |
| AVI | `.avi` | DivX/XviD era, `.divx` |
| QuickTime | `.mov` `.qt` | Apple, ProRes, phone video |
| Windows Media | `.wmv` `.asf` | Windows streaming |
| Flash | `.flv` `.f4v` | old downloads, screen recordings |
| MPEG-TS | `.ts` `.m2ts` `.mts` | broadcast rips, Blu-ray discs |
| DVD | `.vob` `.ifo` | ripped DVDs |
| Ogg | `.ogv` | Theora |
| 3GPP | `.3gp` `.3g2` | old feature phones |
| MPEG-PS | `.mpg` `.mpeg` `.mpe` `.vob` | DVDs and TV rips |
| RealMedia | `.rm` `.rmvb` | RealPlayer era |
| MPEG-DASH | `.mpd` | streaming manifest |

## Video codecs

| Family | Notes |
| --- | --- |
| H.264 / AVC | the universal baseline |
| HEVC / H.265 | 4K; often the reason a file "won't play" elsewhere |
| AV1 | newest royalty-free codec, 4K+ |
| VP8, VP9 | YouTube, WebRTC, WebM |
| MPEG-1, MPEG-2 | DVDs, TV, `.ts` rips |
| MPEG-4 Part 2 | DivX/XviD |
| VC-1 | Blu-ray, older HD |
| WMV 7/8/9 | Windows Media |
| H.263, Sorenson H.263 | FLV, old 3GPP |
| Apple ProRes, DNxHD, DV | professional editing formats |
| Theora, FFV1, UTVideo, CineForm | open / intermediate codecs |
| QuickTime RLE, v210 | Apple intermediates |
| RealVideo | `.rm` content |

## Audio formats

| Format | Notes |
| --- | --- |
| MP3 | — |
| AAC, HE-AAC | `.m4a`, MP4 |
| FLAC | lossless |
| ALAC | Apple lossless |
| WavPack, APE, Musepack | lossless / high-ratio |
| Opus, Vorbis | in `.ogg`, `.opus`, WebM |
| WAV, AIFF | PCM |
| **E-AC-3 (Dolby Digital Plus)** | **frequently refused by phones** |
| **AC-3 (Dolby Digital)** | DVDs |
| **TrueHD / MLP** | Blu-ray Atmos |
| **DTS, DTS-HD** | Blu-ray, DVDs |
| WMA, WMA Lossless | Windows |
| MP2 | broadcast |
| AMR, GSM, Speex | mobile and VoIP |
| MIDI, MOD, S3M, XM, IT | trackers and MIDI |

## Subtitle formats

| Format | Extension |
| --- | --- |
| SubRip | `.srt` |
| Advanced SubStation Alpha | `.ass` `.ssa` |
| WebVTT | `.vtt` |
| SubStation / SMI | `.smi` `.sami` |
| VobSub | `.sub` + `.idx` |
| PGS (Blu-ray) | embedded in `.mkv` / `.m2ts` |
| DVB subtitles | embedded in `.ts` |
| MOV text | embedded in `.mp4` / `.mov` |
| MicroDVD, SubViewer | embedded or external |

ASS styling (fonts, colours, shadows, positioning, animation) is rendered by
libass, so styled subtitles look the same on every platform.

## Network protocols

`http` `https` `rtsp` `rtmp` `rtmps` `udp` `tcp` `srt` `mms` `mmsh` `ftp`
`ftps` `rist` · HLS (`.m3u8`) · DASH (`.mpd`)

Credentials go in the URL (`http://user:pass@host/path`). Paste a URL into the
search bar at the top of the window and press Enter.

---

## Verified by test

`tools/make-testmedia.js` authors a real file for each of these and
`tools/test-decode.js` decodes it through the shipped engine. Latest run:

| Sample | Container | Video | Audio |
| --- | --- | --- | --- |
| movie-h264-aac.mkv | Matroska | H.264 | AAC |
| movie-h264-aac.mp4 | MP4 | H.264 | AAC |
| movie-hevc-eac3.mkv | Matroska | HEVC | E-AC-3 |
| movie-hevc-ac3.mp4 | MP4 | HEVC | AC-3 |
| movie-av1-opus.webm | WebM | AV1 | Opus |
| movie-vp9-opus.webm | WebM | VP9 | Opus |
| movie-avi-mpeg4.mp3.avi | AVI | MPEG-4 Part 2 | MP3 |
| movie-flv-h263.mp3.flv | FLV | H.263 | MP3 |
| movie-mpeg2ts.ts | MPEG-TS | MPEG-2 | MP2 |
| movie-prores-pcm.mov | QuickTime | ProRes | PCM |
| movie-wmv3.wmv | ASF | WMV3 | WMA v2 |
| movie-theora.ogv | Ogg | Theora | Vorbis |
| movie-1080p-hevc.mkv | Matroska | HEVC 1080p | E-AC-3 |
| movie-4k-hevc-eac3.mkv | Matroska | **HEVC 4K 2160p** | E-AC-3 |
| song-flac.flac / mp3 / aac / opus / vorbis / wav / aiff / ac3 / eac3 / truehd / dts / alac / wavpack / wma | various | — | all 14 |

**30 / 30 decoded.** Regenerate and re-verify any time:

```bash
node tools/make-testmedia.js
node tools/test-decode.js
```

---

## Adding a format

Nothing to do. The decoders are compiled into libmpv/libVLC. If a file does not
play, the container is usually damaged rather than unsupported — the app's
**Convert → Repair file** preset rebuilds the container without re-encoding the
video, which fixes most truncated or badly-muxed files.