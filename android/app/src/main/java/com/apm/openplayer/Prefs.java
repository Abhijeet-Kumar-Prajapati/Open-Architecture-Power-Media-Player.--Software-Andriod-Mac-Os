package com.apm.openplayer;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Typed accessors over SharedPreferences. Small on purpose - everything the
 * player remembers lives here and is restored on launch.
 */
public final class Prefs {

    private static final String FILE = "apm-open-player";

    private static final String K_VOLUME = "volume";
    private static final String K_MUTE = "mute";
    private static final String K_SPEED = "speed";
    private static final String K_LOOP = "loop";
    private static final String K_SHUFFLE = "shuffle";
    private static final String K_HWDEC = "hwdec";
    private static final String K_RESUME = "resume";
    private static final String K_SUB_SIZE = "subSize";
    private static final String K_SUB_COLOR = "subColor";
    private static final String K_SUB_OUTLINE = "subOutline";
    private static final String K_SUB_FONT = "subFont";
    private static final String K_PREF_RESUME_PREFIX = "pos:";
    private static final String K_PREF_RECENTS = "recents";
    private static final String K_EQUALIZER = "equalizer";
    private static final String K_KEEP_SCREEN_ON = "keepScreenOn";
    private static final String K_DEFAULT_BRIGHTNESS = "defaultBrightness";

    private final SharedPreferences sp;

    public Prefs(Context ctx) {
        this.sp = ctx.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    public int volume() { return sp.getInt(K_VOLUME, 80); }
    public void volume(int v) { sp.edit().putInt(K_VOLUME, Math.max(0, Math.min(125, v))).apply(); }

    public boolean muted() { return sp.getBoolean(K_MUTE, false); }
    public void muted(boolean m) { sp.edit().putBoolean(K_MUTE, m).apply(); }

    public float speed() { return sp.getFloat(K_SPEED, 1f); }
    public void speed(float s) { sp.edit().putFloat(K_SPEED, s).apply(); }

    public boolean loop() { return sp.getBoolean(K_LOOP, false); }
    public void loop(boolean v) { sp.edit().putBoolean(K_LOOP, v).apply(); }

    public boolean shuffle() { return sp.getBoolean(K_SHUFFLE, false); }
    public void shuffle(boolean v) { sp.edit().putBoolean(K_SHUFFLE, v).apply(); }

    /** Hardware decoding preference; empty means "let libVLC decide". */
    public String hwdec() { return sp.getString(K_HWDEC, "any"); }
    public void hwdec(String v) { sp.edit().putString(K_HWDEC, v == null ? "any" : v).apply(); }

    public boolean resumePlayback() { return sp.getBoolean(K_RESUME, true); }
    public void resumePlayback(boolean v) { sp.edit().putBoolean(K_RESUME, v).apply(); }

    public boolean keepScreenOn() { return sp.getBoolean(K_KEEP_SCREEN_ON, true); }
    public void keepScreenOn(boolean v) { sp.edit().putBoolean(K_KEEP_SCREEN_ON, v).apply(); }

    public int defaultBrightness() { return sp.getInt(K_DEFAULT_BRIGHTNESS, -1); }
    public void defaultBrightness(int v) { sp.edit().putInt(K_DEFAULT_BRIGHTNESS, v).apply(); }

    // --- subtitles --------------------------------------------------------
    public int subSize() { return sp.getInt(K_SUB_SIZE, 28); }
    public void subSize(int v) { sp.edit().putInt(K_SUB_SIZE, v).apply(); }

    public String subColor() { return sp.getString(K_SUB_COLOR, "#FFFFFF"); }
    public void subColor(String v) { sp.edit().putString(K_SUB_COLOR, v).apply(); }

    public int subOutline() { return sp.getInt(K_SUB_OUTLINE, 2); }
    public void subOutline(int v) { sp.edit().putInt(K_SUB_OUTLINE, v).apply(); }

    public String subFont() { return sp.getString(K_SUB_FONT, ""); }
    public void subFont(String v) { sp.edit().putString(K_SUB_FONT, v).apply(); }

    // --- resume positions -------------------------------------------------
    public long resumePosition(String path) {
        return sp.getLong(K_PREF_RESUME_PREFIX + path.toLowerCase(), 0L);
    }

    public void saveResumePosition(String path, long positionMs) {
        sp.edit().putLong(K_PREF_RESUME_PREFIX + path.toLowerCase(), positionMs).apply();
    }

    public void clearResumePosition(String path) {
        sp.edit().remove(K_PREF_RESUME_PREFIX + path.toLowerCase()).apply();
    }

    // --- recents ----------------------------------------------------------
    public String recents() { return sp.getString(K_PREF_RECENTS, ""); }
    public void setRecents(String v) { sp.edit().putString(K_PREF_RECENTS, v).apply(); }

    // --- equalizer (serialised as "enabled:low,mid,high") -----------------
    public String equalizer() { return sp.getString(K_EQUALIZER, ""); }
    public void equalizer(String v) { sp.edit().putString(K_EQUALIZER, v == null ? "" : v).apply(); }
}