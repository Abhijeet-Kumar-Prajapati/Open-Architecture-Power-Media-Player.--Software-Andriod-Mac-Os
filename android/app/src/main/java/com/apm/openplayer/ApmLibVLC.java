package com.apm.openplayer;

import android.content.Context;

import org.videolan.libvlc.LibVLC;
import org.videolan.libvlc.Media;

import java.util.ArrayList;
import java.util.List;

/**
 * Builds the libVLC instance APM Open Player runs on.
 *
 * libVLC is FFmpeg's demuxer/decoder stack plus mpv's player core, which is why
 * this one object covers every format: MKV/AVI/TS/FLV/RMVB, HEVC/AV1/VP9,
 * and the audio codecs Android's own MediaCodec stack usually refuses
 * (E-AC-3, TrueHD, DTS, APE).
 */
public final class ApmLibVLC {

    private ApmLibVLC() {}

    public static LibVLC create(Context ctx, String hwdec) {
        ArrayList<String> options = new ArrayList<>();

        // --- decoding -------------------------------------------------------
        options.add("--avcodec-hw=" + (hwdec == null || hwdec.isEmpty() ? "any" : hwdec));
        options.add("--avcodec-skip-frame=0");
        options.add("--avcodec-skip-loopfilter=0");

        // --- network --------------------------------------------------------
        options.add("--network-caching=1500");
        options.add("--live-caching=3000");
        options.add("--file-caching=300");
        options.add("--http-reconnect=1");
        options.add("--clock-jitter=0");
        options.add("--clock-synchro=-1");

        // --- subtitle rendering --------------------------------------------
        options.add("--freetype-rel-fontsize=24");
        options.add("--freetype-bold");
        options.add("--freetype-background-opacity=140");
        options.add("--freetype-outline-thickness=2");
        options.add("--sub-margin=24");
        options.add("--sub-text-scale=100");

        // --- audio ----------------------------------------------------------
        options.add("--audio-time-stretch");
        options.add("--gain=1.0");

        // libVLC is chatty by default on Android.
        options.add("--quiet");
        options.add("--no-video-title-show");
        options.add("--no-osd");

        return new LibVLC(ctx, options);
    }

    /** Build a Media item for a local file, a content:// URI or a network URL. */
    public static Media mediaFor(LibVLC libvlc, String location, String mime) {
        // libVLC identifies the container from the file itself, so no MIME
        // hint is set here - guessing wrong would be worse than not guessing.
        return new Media(libvlc, location);
    }

    /**
     * Best-effort MIME type. libVLC sniffs the container itself, so this is only
     * a hint - getting it wrong is harmless, which is why an unknown extension
     * simply passes through.
     */
    public static String guessMime(String path) {
        if (path == null) return "";
        String p = path.toLowerCase();
        if (p.startsWith("http") || p.startsWith("rtsp") || p.startsWith("rtmp")) return "";
        int dot = p.lastIndexOf('.');
        if (dot < 0) return "";
        switch (p.substring(dot + 1)) {
            case "mp4": case "m4v": case "m4a": case "aac":
                return "video/mp4";
            case "mkv": case "mka":
                return "video/x-matroska";
            case "webm":
                return "video/webm";
            case "avi":
                return "video/x-msvideo";
            case "mov": case "qt":
                return "video/quicktime";
            case "wmv": case "asf":
                return "video/x-ms-wmv";
            case "flv": case "f4v":
                return "video/x-flv";
            case "ts": case "m2ts": case "mts":
                return "video/mp2t";
            case "3gp": case "3g2":
                return "video/3gpp";
            case "ogv":
                return "video/ogg";
            case "mpg": case "mpeg": case "mpe":
                return "video/mpeg";
            case "vob":
                return "video/dvd";
            case "mp3":
                return "audio/mpeg";
            case "flac":
                return "audio/flac";
            case "wav":
                return "audio/wav";
            case "ogg": case "oga": case "opus":
                return "audio/ogg";
            case "aiff": case "aif":
                return "audio/aiff";
            case "wma":
                return "audio/x-ms-wma";
            case "srt":
                return "application/x-subrip";
            case "ass": case "ssa":
                return "text/x-ssa";
            case "vtt":
                return "text/vtt";
            default:
                return "";
        }
    }

    /** Human readable codec name for the media-information panel. */
    public static String codecLabel(String codec, int width, int height) {
        if (codec == null || codec.isEmpty()) return "unknown";
        String lower = codec.toLowerCase();
        String friendly;
        if (lower.contains("hevc") || lower.contains("h265")) friendly = "HEVC / H.265";
        else if (lower.contains("h264") || lower.contains("avc")) friendly = "H.264 / AVC";
        else if (lower.contains("av1")) friendly = "AV1";
        else if (lower.contains("vp9")) friendly = "VP9";
        else if (lower.contains("vp8")) friendly = "VP8";
        else if (lower.contains("mpeg4")) friendly = "MPEG-4 Part 2";
        else if (lower.contains("mpeg2")) friendly = "MPEG-2";
        else if (lower.contains("wmv3")) friendly = "Windows Media Video 9";
        else if (lower.contains("hevc")) friendly = "HEVC";
        else if (lower.contains("prores")) friendly = "Apple ProRes";
        else if (lower.contains("eac3") || lower.contains("ec3")) friendly = "Dolby Digital Plus (E-AC-3)";
        else if (lower.contains("ac3")) friendly = "Dolby Digital (AC-3)";
        else if (lower.contains("truehd")) friendly = "Dolby TrueHD";
        else if (lower.contains("dts")) friendly = "DTS";
        else if (lower.contains("opus")) friendly = "Opus";
        else if (lower.contains("vorbis")) friendly = "Vorbis";
        else if (lower.contains("flac")) friendly = "FLAC";
        else if (lower.contains("aac")) friendly = "AAC";
        else if (lower.contains("mp3") || lower.contains("mpga")) friendly = "MP3";
        else if (lower.contains("ape")) friendly = "Monkey's Audio";
        else friendly = codec.toUpperCase();

        if (width > 0 && height > 0) return friendly + "  ·  " + width + "×" + height;
        return friendly;
    }

    public static List<String> hwdecOptions() {
        List<String> out = new ArrayList<>();
        out.add("any");
        out.add("d3d11va");
        out.add("nvdec");
        out.add("qsv");
        out.add("mediacodec");
        out.add("vaapi");
        out.add("");
        return out;
    }
}