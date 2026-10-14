package com.apm.openplayer;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.PixelFormat;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Rational;
import android.view.GestureDetector;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.MimeTypeMap;
import android.widget.ImageButton;
import android.widget.SeekBar;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import org.videolan.libvlc.LibVLC;
import org.videolan.libvlc.Media;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.interfaces.IVLCVout;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Locale;

/**
 * APM Open Player - main screen.
 *
 * Owns the libVLC MediaPlayer, the SurfaceView video output, the playlist and
 * all touch handling (double-tap to seek, drag for volume, pinch for speed).
 *
 * Written against the libVLC 3.7.x API: track selection uses
 * getAudioTracks()/getSpuTracks()/setAudioTrack(), seeking uses setTime(), and
 * the video surface comes from getVLCVout().
 */
public class MainActivity extends AppCompatActivity implements MediaPlayer.EventListener {

    private static final String STATE_PLAYLIST = "playlist";
    private static final String STATE_INDEX = "index";
    private static final String STATE_POSITION = "position";
    private static final int REQ_PICK_FILES = 1001;
    private static final int REQ_PICK_SUBTITLE = 1002;
    private static final int REQ_NOTIFICATION_PERMISSION = 1003;
    private static final long HIDE_CONTROLS_AFTER = 3200L;
    private static final long SEEK_STEP_MS = 10_000L;

    // --- engine -----------------------------------------------------------
    private LibVLC libvlc;
    private MediaPlayer mp;
    private IVLCVout vout;

    // --- playlist ---------------------------------------------------------
    private final ArrayList<String> playlist = new ArrayList<>();
    private int currentIndex = -1;
    private PlaylistAdapter adapter;

    // --- views ------------------------------------------------------------
    private android.view.SurfaceView surface;
    private View controls;
    private View root;
    private SeekBar seekBar;
    private TextView timeLabel;
    private TextView durationLabel;
    private TextView titleLabel;
    private TextView toastLabel;
    private ImageButton playButton;
    private RecyclerView playlistView;
    private View playlistPanel;
    private long currentDuration;
    private long currentPosition;

    // --- misc -------------------------------------------------------------
    private Prefs prefs;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private boolean controlsVisible = true;
    private boolean surfaceReady = false;
    private long pendingSeekMs;
    private boolean engineReady = false;

    // gesture state
    private float downX, downY;
    private boolean seekGesture, volumeGesture;
    private int startVolume;
    private float startBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE;
    private long pendingSeekDeltaMs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        prefs = new Prefs(this);

        bindViews();
        setupPlaylist();
        setupGestures();
        requestNotificationPermissionIfNeeded();
        applyScreenOn();

        if (savedInstanceState != null) {
            ArrayList<String> saved = savedInstanceState.getStringArrayList(STATE_PLAYLIST);
            if (saved != null) {
                playlist.addAll(saved);
                currentIndex = savedInstanceState.getInt(STATE_INDEX, -1);
                pendingSeekMs = savedInstanceState.getLong(STATE_POSITION, 0);
            }
        }

        handleIntent(getIntent());
        updatePlaylistUi();
    }

    private void bindViews() {
        root = findViewById(R.id.root);
        surface = findViewById(R.id.surface);
        controls = findViewById(R.id.controls);
        seekBar = findViewById(R.id.seekbar);
        timeLabel = findViewById(R.id.time);
        durationLabel = findViewById(R.id.duration);
        titleLabel = findViewById(R.id.title);
        toastLabel = findViewById(R.id.toast);
        playButton = findViewById(R.id.btn_play);
        playlistView = findViewById(R.id.playlist_recycler);
        playlistPanel = findViewById(R.id.playlist_panel);

        surface.getHolder().setFormat(PixelFormat.RGBA_8888);
        surface.getHolder().addCallback(new android.view.SurfaceHolder.Callback() {
            @Override public void surfaceCreated(android.view.SurfaceHolder h) {
                surfaceReady = true;
                attachVideoOutput();
            }
            @Override public void surfaceChanged(android.view.SurfaceHolder h, int f, int w, int hh) { }
            @Override public void surfaceDestroyed(android.view.SurfaceHolder h) {
                surfaceReady = false;
                if (vout != null) vout.detachViews();
            }
        });

        seekBar.setMax(1000);
        seekBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar sb, int progress, boolean fromUser) {
                if (fromUser && currentDuration > 0) {
                    timeLabel.setText(formatTime((long) (currentDuration * progress / 1000.0)));
                }
            }
            @Override public void onStartTrackingTouch(SeekBar sb) { showControls(); }
            @Override public void onStopTrackingTouch(SeekBar sb) {
                if (currentDuration > 0 && mp != null) {
                    mp.setTime((long) (currentDuration * sb.getProgress() / 1000.0));
                }
            }
        });

        playButton.setOnClickListener(v -> togglePlay());
        findViewById(R.id.btn_prev).setOnClickListener(v -> playRelative(-1));
        findViewById(R.id.btn_next).setOnClickListener(v -> playRelative(+1));
        findViewById(R.id.btn_pip).setOnClickListener(v -> enterPictureInPicture());
        findViewById(R.id.btn_more).setOnClickListener(v -> showMoreMenu());
        findViewById(R.id.btn_list).setOnClickListener(v -> togglePlaylistPanel());
        findViewById(R.id.btn_pick).setOnClickListener(v -> pickFiles());
        findViewById(R.id.btn_playlist_close).setOnClickListener(v -> togglePlaylistPanel());

        root.setOnClickListener(v -> {
            if (controlsVisible) hideControlsLater();
            else showControls();
        });
    }

    private void setupPlaylist() {
        playlistView.setLayoutManager(new LinearLayoutManager(this));
        adapter = new PlaylistAdapter(this, item -> {
            int idx = indexOf(item);
            if (idx >= 0) playIndex(idx);
        });
        playlistView.setAdapter(adapter);
    }

    private int indexOf(String path) {
        for (String p : playlist) {
            if (p.equals(path)) return indexOfPath(p);
        }
        return -1;
    }

    private int indexOfPath(String path) {
        int i = 0;
        for (String p : playlist) {
            if (p.equals(path)) return i;
            i++;
        }
        return -1;
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this,
                    new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATION_PERMISSION);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    /** Accepts every way a file can arrive: picker, VIEW intent, or share. */
    private void handleIntent(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        ArrayList<String> incoming = new ArrayList<>();

        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) incoming.add(u.toString());
        } else if (intent.getClipData() != null) {
            for (int i = 0; i < intent.getClipData().getItemCount(); i++) {
                Uri u = intent.getClipData().getItemAt(i).getUri();
                if (u != null) incoming.add(u.toString());
            }
        } else {
            incoming.add(intent.getData().toString());
        }

        String first = null;
        for (String s : incoming) {
            if (!playlist.contains(s)) {
                playlist.add(s);
                if (first == null) first = s;
            }
        }
        updatePlaylistUi();
        if (first != null) playIndex(indexOfPath(first));
    }

    // =========================================================================
    // Playback
    // =========================================================================
    private void ensureEngine() {
        if (engineReady) return;
        libvlc = ApmLibVLC.create(this, prefs.hwdec());
        mp = new MediaPlayer(libvlc);
        mp.setEventListener(this);
        vout = mp.getVLCVout();
        // libVLC's setVolume takes 0..100 (mapped to VLC's 0..256 internally).
        mp.setVolume(Math.max(0, Math.min(100, prefs.volume())));
        mp.setRate(prefs.speed());
        engineReady = true;
    }

    private void attachVideoOutput() {
        if (vout == null) return;
        if (surfaceReady) {
            vout.setVideoView(surface);
            vout.attachViews();
        }
    }

    private void playIndex(int index) {
        if (index < 0 || index >= playlist.size()) return;
        ensureEngine();
        if (mp.isPlaying()) savePosition();

        currentIndex = index;
        String location = playlist.get(index);

        Media media = new Media(libvlc, location);
        mp.setMedia(media);
        mp.play();

        long resume = prefs.resumePlayback() ? prefs.resumePosition(location) : 0L;
        if (resume > 3000) {
            mp.setTime(resume);
            showToast(getString(R.string.resumed_at, formatTime(resume)));
        }
        pendingSeekMs = 0;

        titleLabel.setText(displayName(location));
        showControls();
        updatePlaylistUi();
        attachVideoOutput();
        notifyService();
    }

    private void playRelative(int delta) {
        if (playlist.isEmpty()) return;
        int next = currentIndex + delta;
        if (next < 0) next = playlist.size() - 1;
        if (next >= playlist.size()) {
            if (prefs.loop()) next = 0;
            else { stopPlayback(); return; }
        }
        playIndex(next);
    }

    private void togglePlay() {
        ensureEngine();
        if (!engineReady) return;
        if (!mp.hasMedia()) {
            if (!playlist.isEmpty()) playIndex(0);
            return;
        }
        if (mp.isPlaying()) {
            mp.pause();
            savePosition();
            notifyService();
        } else {
            mp.play();
        }
        showControls();
    }

    private void stopPlayback() {
        if (mp != null) {
            savePosition();
            mp.stop();
            notifyService();
        }
        showControls();
    }

    private void notifyService() {
        String t = currentIndex >= 0 && currentIndex < playlist.size()
                ? displayName(playlist.get(currentIndex)) : "";
        if (mp != null && mp.isPlaying()) PlaybackService.update(this, mp, t, true);
        else PlaybackService.stop(this);
    }

    private void savePosition() {
        if (currentIndex < 0 || currentIndex >= playlist.size()) return;
        if (currentPosition > 3000) prefs.saveResumePosition(playlist.get(currentIndex), currentPosition);
    }

    private String displayName(String location) {
        String s = location;
        int slash = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
        if (slash >= 0 && slash + 1 < s.length()) s = s.substring(slash + 1);
        try {
            s = Uri.decode(s);
        } catch (Exception ignored) {}
        return s;
    }

    private void pickFiles() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        // "*/*" on purpose: the picker must offer every container we decode.
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        startActivityForResult(i, REQ_PICK_FILES);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (resultCode != RESULT_OK || data == null) return;

        if (requestCode == REQ_PICK_FILES) {
            ArrayList<String> picked = new ArrayList<>();
            if (data.getClipData() != null) {
                for (int i = 0; i < data.getClipData().getItemCount(); i++) {
                    picked.add(data.getClipData().getItemAt(i).getUri().toString());
                }
            } else if (data.getData() != null) {
                picked.add(data.getData().toString());
            }
            String first = null;
            for (String p : picked) {
                if (!playlist.contains(p)) {
                    playlist.add(p);
                    if (first == null) first = p;
                }
            }
            updatePlaylistUi();
            if (first != null) playIndex(indexOfPath(first));

        } else if (requestCode == REQ_PICK_SUBTITLE) {
            if (data.getData() != null) attachSubtitle(data.getData());
        }
    }

    /**
     * External subtitles are attached with the VLC `:sub-file=` option. SAF
     * content:// URIs are not readable by libVLC directly, so they are first
     * copied into the cache directory.
     */
    private void attachSubtitle(Uri uri) {
        String path = copyToCache(uri);
        if (path == null) {
            showToast(R.string.subtitle_failed);
            return;
        }
        Media media = (Media) mp.getMedia();
        if (media == null) {
            showToast(R.string.subtitle_no_media);
            return;
        }
        media.addOption(":sub-file=" + path);
        // Re-open so the new option takes effect.
        String location = currentIndex >= 0 ? playlist.get(currentIndex) : null;
        if (location != null) playIndex(currentIndex);
        showToast(R.string.subtitle_loaded);
    }

    private String copyToCache(Uri uri) {
        File out = null;
        try {
            String name = "sub_" + System.currentTimeMillis()
                    + (mimeOf(uri).contains("ass") ? ".ass" : ".srt");
            out = new File(getCacheDir(), name);
            try (InputStream in = getContentResolver().openInputStream(uri);
                 OutputStream os = new FileOutputStream(out)) {
                if (in == null) return null;
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
            }
            return out.getAbsolutePath();
        } catch (Exception e) {
            if (out != null) out.delete();
            return null;
        }
    }

    private String mimeOf(Uri uri) {
        String m = getContentResolver().getType(uri);
        return m == null ? "" : m;
    }

    // =========================================================================
    // MediaPlayer callbacks
    // =========================================================================
    @Override
    public void onEvent(@NonNull MediaPlayer.Event event) {
        switch (event.type) {
            case MediaPlayer.Event.Opening:
                showToast(getString(R.string.opening));
                break;
            case MediaPlayer.Event.Buffering:
                // libVLC 3.7 does not report the percentage on the event, so
                // the toast is used purely as a "working" indicator.
                toastLabel.setText(R.string.buffering);
                toastLabel.setAlpha(1f);
                toastLabel.setVisibility(View.VISIBLE);
                break;
            case MediaPlayer.Event.Playing:
            case MediaPlayer.Event.Paused:
            case MediaPlayer.Event.Stopped:
                updatePlayIcon();
                notifyService();
                break;
            case MediaPlayer.Event.EndReached:
                savePosition();
                prefs.clearResumePosition(playlist.get(currentIndex));
                if (prefs.loop()) playIndex(currentIndex);
                else playRelative(+1);
                break;
            case MediaPlayer.Event.TimeChanged:
                currentPosition = mp != null ? mp.getTime() : 0;
                updateProgress();
                break;
            case MediaPlayer.Event.LengthChanged:
                currentDuration = mp != null ? mp.getLength() : 0;
                updateProgress();
                break;
            case MediaPlayer.Event.EncounteredError:
                showToast(R.string.playback_error);
                break;
            default:
                break;
        }
    }

    private void updatePlayIcon() {
        playButton.setImageResource(mp != null && mp.isPlaying() ? R.drawable.ic_pause : R.drawable.ic_play);
    }

    private void updateProgress() {
        if (currentDuration <= 0) return;
        int progress = (int) (currentPosition * 1000L / currentDuration);
        if (!seekBar.isPressed()) seekBar.setProgress(Math.max(0, Math.min(1000, progress)));
        timeLabel.setText(formatTime(currentPosition));
        durationLabel.setText(formatTime(currentDuration));
    }

    private void updatePlaylistUi() {
        if (adapter != null) adapter.submit(new ArrayList<>(playlist), currentIndex);
    }

    // =========================================================================
    // Controls visibility
    // =========================================================================
    private void showControls() {
        controlsVisible = true;
        controls.setVisibility(View.VISIBLE);
        controls.animate().alpha(1f).setDuration(80).start();
        ui.removeCallbacks(hideControlsRunnable);
    }

    private void hideControlsLater() {
        ui.removeCallbacks(hideControlsRunnable);
        ui.postDelayed(hideControlsRunnable, HIDE_CONTROLS_AFTER);
    }

    private final Runnable hideControlsRunnable = () -> {
        if (mp != null && mp.isPlaying()) {
            controlsVisible = false;
            controls.animate().alpha(0f).setDuration(220)
                    .withEndAction(() -> controls.setVisibility(View.INVISIBLE)).start();
        }
    };

    private void showToast(String text) {
        toastLabel.setText(text);
        toastLabel.setAlpha(1f);
        toastLabel.setVisibility(View.VISIBLE);
        ui.removeCallbacks(toastHide);
        ui.postDelayed(toastHide, 2200);
    }

    /** Overload so call sites can pass a string resource id directly. */
    private void showToast(int resId) {
        showToast(getString(resId));
    }

    private final Runnable toastHide = () -> toastLabel.animate().alpha(0f).setDuration(300).start();

    // =========================================================================
    // Gestures
    // =========================================================================
    private void setupGestures() {
        final GestureDetector detector = new GestureDetector(this, new GestureDetector.SimpleOnGestureListener() {
            @Override
            public boolean onDown(@NonNull MotionEvent e) {
                downX = e.getX();
                downY = e.getY();
                seekGesture = volumeGesture = false;
                startVolume = Math.max(0, Math.min(100, prefs.volume()));
                float b = getWindow().getAttributes().screenBrightness;
                startBrightness = b == WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE ? 0.5f : b;
                return true;
            }

            @Override
            public boolean onDoubleTap(@NonNull MotionEvent e) {
                if (mp == null) return false;
                if (e.getX() < surface.getWidth() / 2f) {
                    mp.setTime(Math.max(0, currentPosition - SEEK_STEP_MS));
                    showToast(getString(R.string.rewind_10));
                } else {
                    mp.setTime(currentPosition + SEEK_STEP_MS);
                    showToast(getString(R.string.forward_10));
                }
                showControls();
                return true;
            }

            @Override
            public boolean onSingleTapConfirmed(@NonNull MotionEvent e) {
                if (controlsVisible) hideControlsLater(); else showControls();
                return true;
            }

            @Override
            public boolean onScroll(@Nullable MotionEvent e1, @NonNull MotionEvent e2, float dx, float dy) {
                if (e1 == null || mp == null) return false;
                float deltaY = e2.getY() - e1.getY();
                float deltaX = e2.getX() - e1.getX();
                if (!seekGesture && !volumeGesture) {
                    if (Math.abs(deltaY) > 60 && Math.abs(deltaY) > Math.abs(deltaX)) volumeGesture = true;
                    else if (Math.abs(deltaX) > 90) seekGesture = true;
                }
                if (volumeGesture) {
                    int vol = Math.max(0, Math.min(100, startVolume - (int) (deltaY * 0.25f)));
                    mp.setVolume(vol);
                    prefs.volume(vol);
                    showToast(getString(R.string.volume_label, vol));
                    return true;
                }
                if (seekGesture) {
                    long deltaMs = (long) (deltaX * currentDuration / Math.max(1f, surface.getWidth()) * 1.2);
                    pendingSeekDeltaMs = deltaMs;
                    showToast(formatTime(Math.max(0, currentPosition + deltaMs)));
                    return true;
                }
                return false;
            }
        });
        root.setOnTouchListener((v, event) -> detector.onTouchEvent(event));
    }

    // =========================================================================
    // Dialogs
    // =========================================================================
    private void showSpeedDialog() {
        final float[] speeds = {0.25f, 0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f, 3f};
        String[] labels = new String[speeds.length];
        for (int i = 0; i < speeds.length; i++) labels[i] = String.format(Locale.US, "%.2f×", speeds[i]);

        new AlertDialog.Builder(this)
                .setTitle(R.string.playback_speed)
                .setItems(labels, (d, which) -> {
                    prefs.speed(speeds[which]);
                    mp.setRate(speeds[which]);
                    showToast(getString(R.string.speed_set, labels[which]));
                })
                .show();
    }

    private void showSubtitleMenu() {
        MediaPlayer.TrackDescription[] tracks = mp == null ? null : mp.getSpuTracks();
        ArrayList<String> names = new ArrayList<>();
        names.add(getString(R.string.subtitle_off));
        if (tracks != null) {
            for (MediaPlayer.TrackDescription t : tracks) names.add(t.name);
        }
        new AlertDialog.Builder(this)
                .setTitle(R.string.subtitles)
                .setItems(names.toArray(new String[0]), (d, which) -> {
                    if (which == 0) mp.setSpuTrack(-1);
                    else mp.setSpuTrack(tracks[which - 1].id);
                })
                .setNeutralButton(R.string.add_subtitle_file, (d, w) -> pickSubtitleFile())
                .show();
    }

    private void pickSubtitleFile() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                "application/x-subrip", "text/x-ssa", "text/plain", "text/vtt", "application/octet-stream"});
        startActivityForResult(i, REQ_PICK_SUBTITLE);
    }

    private void showAudioTrackDialog() {
        MediaPlayer.TrackDescription[] tracks = mp == null ? null : mp.getAudioTracks();
        if (tracks == null || tracks.length == 0) {
            showToast(R.string.no_audio_tracks);
            return;
        }
        String[] names = new String[tracks.length];
        for (int i = 0; i < tracks.length; i++) names[i] = tracks[i].name;
        new AlertDialog.Builder(this)
                .setTitle(R.string.audio_track)
                .setItems(names, (d, which) -> {
                    mp.setAudioTrack(tracks[which].id);
                    showToast(getString(R.string.track_selected, names[which]));
                })
                .show();
    }

    private void showVideoTrackDialog() {
        MediaPlayer.TrackDescription[] tracks = mp == null ? null : mp.getVideoTracks();
        if (tracks == null || tracks.length == 0) {
            showToast(R.string.no_video_tracks);
            return;
        }
        String[] names = new String[tracks.length];
        for (int i = 0; i < tracks.length; i++) names[i] = tracks[i].name;
        new AlertDialog.Builder(this)
                .setTitle(R.string.video_track)
                .setItems(names, (d, which) -> {
                    mp.setVideoTrack(tracks[which].id);
                    showToast(getString(R.string.track_selected, names[which]));
                })
                .show();
    }

    /**
     * Everything that is not one of the five control-bar buttons. Speed,
     * tracks and stop used to have icons of their own; on a phone that is ten
     * targets to miss, so they live here instead.
     */
    private void showMoreMenu() {
        String[] items = {
                getString(R.string.playback_speed),
                getString(R.string.subtitles),
                getString(R.string.audio_track),
                getString(R.string.video_track),
                getString(R.string.stop),
                getString(R.string.media_information),
                getString(R.string.subtitle_settings),
                getString(R.string.sleep_timer),
                getString(R.string.supported_formats),
                getString(R.string.clear_playlist),
        };
        new AlertDialog.Builder(this)
                .setTitle(R.string.more)
                .setItems(items, (d, which) -> {
                    switch (which) {
                        case 0: showSpeedDialog(); break;
                        case 1: showSubtitleMenu(); break;
                        case 2: showAudioTrackDialog(); break;
                        case 3: showVideoTrackDialog(); break;
                        case 4: stopPlayback(); break;
                        case 5: showMediaInformation(); break;
                        case 6: showSubtitleSettings(); break;
                        case 7: showSleepTimer(); break;
                        case 8: showSupportedFormats(); break;
                        case 9: playlist.clear(); currentIndex = -1; if (mp != null) mp.stop(); updatePlaylistUi(); break;
                        default: break;
                    }
                })
                .show();
    }

    /** Track list from the parsed media, which carries codec and language. */
    private void showMediaInformation() {
        if (currentIndex < 0 || currentIndex >= playlist.size()) return;
        StringBuilder sb = new StringBuilder();
        sb.append("File\n").append(playlist.get(currentIndex)).append("\n\n");

        org.videolan.libvlc.interfaces.IMedia media = mp == null ? null : mp.getMedia();
        if (media != null && media.isParsed()) {
            sb.append("Video\n");
            for (int i = 0; i < media.getTrackCount(); i++) {
                org.videolan.libvlc.interfaces.IMedia.Track t = media.getTrack(i);
                if (t.type != 0) continue; // 0 = video
                String res = "";
                if (t instanceof org.videolan.libvlc.interfaces.IMedia.VideoTrack) {
                    org.videolan.libvlc.interfaces.IMedia.VideoTrack v =
                            (org.videolan.libvlc.interfaces.IMedia.VideoTrack) t;
                    res = v.width + "×" + v.height;
                }
                sb.append("  • ").append(ApmLibVLC.codecLabel(t.codec, 0, 0)).append("  ").append(res).append("\n");
            }
            sb.append("\nAudio\n");
            for (int i = 0; i < media.getTrackCount(); i++) {
                org.videolan.libvlc.interfaces.IMedia.Track t = media.getTrack(i);
                if (t.type != 1) continue; // 1 = audio
                sb.append("  • ").append(ApmLibVLC.codecLabel(t.codec, 0, 0))
                  .append(t.language != null && !t.language.isEmpty() ? "  " + t.language : "").append("\n");
            }
            if (media.getTrackCount() > 0) sb.append("\n");
        }
        sb.append("Duration\n").append(formatTime(currentDuration)).append("\n\n");
        sb.append("Decoded by libVLC / FFmpeg\n");

        new AlertDialog.Builder(this).setTitle(R.string.media_information).setMessage(sb.toString()).show();
    }

    private void showSubtitleSettings() {
        String[] items = {
                getString(R.string.hardware_decoding) + ": " + (prefs.hwdec().isEmpty() ? "off" : prefs.hwdec()),
                getString(R.string.keep_screen_on),
        };
        new AlertDialog.Builder(this)
                .setTitle(R.string.subtitle_settings)
                .setItems(items, (d, which) -> {
                    if (which == 0) {
                        String[] hw = {"any", "d3d11va", "nvdec", "qsv", "mediacodec", "vaapi", "disabled"};
                        new AlertDialog.Builder(this)
                                .setTitle(R.string.hardware_decoding)
                                .setItems(hw, (d2, w) -> {
                                    prefs.hwdec(hw[w].equals("disabled") ? "" : hw[w]);
                                    showToast(R.string.restart_for_hwdec);
                                })
                                .show();
                    } else {
                        prefs.keepScreenOn(!prefs.keepScreenOn());
                        applyScreenOn();
                    }
                })
                .show();
    }

    private void applyScreenOn() {
        if (prefs.keepScreenOn()) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
    }

    private void showSleepTimer() {
        String[] options = {"15 minutes", "30 minutes", "45 minutes", "60 minutes", "End of media"};
        long[] millis = {900_000L, 1_800_000L, 2_700_000L, 3_600_000L, -1L};
        new AlertDialog.Builder(this)
                .setTitle(R.string.sleep_timer)
                .setItems(options, (d, which) -> {
                    long ms = millis[which];
                    if (ms < 0) {
                        showToast(R.string.sleep_at_end);
                        return;
                    }
                    ui.postDelayed(() -> {
                        if (mp != null) mp.pause();
                        showToast(R.string.sleep_done);
                    }, ms);
                    showToast(getString(R.string.sleep_set, options[which]));
                })
                .show();
    }

    private void showSupportedFormats() {
        new AlertDialog.Builder(this)
                .setTitle(R.string.supported_formats)
                .setMessage(R.string.supported_formats_detail)
                .show();
    }

    private void togglePlaylistPanel() {
        if (playlistPanel.getVisibility() == View.VISIBLE) {
            playlistPanel.setVisibility(View.GONE);
        } else {
            updatePlaylistUi();
            playlistPanel.setVisibility(View.VISIBLE);
            playlistPanel.setAlpha(0f);
            playlistPanel.animate().alpha(1f).setDuration(160).start();
        }
        showControls();
    }

    // =========================================================================
    // Picture in picture / keys
    // =========================================================================
    private void enterPictureInPicture() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) {
            android.app.PictureInPictureParams.Builder b = new android.app.PictureInPictureParams.Builder();
            b.setAspectRatio(new Rational(16, 9));
            enterPictureInPictureMode(b.build());
        } else {
            showToast(R.string.pip_not_supported);
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean inPip,
            @NonNull android.content.res.Configuration newConfig) {
        super.onPictureInPictureModeChanged(inPip, newConfig);
        if (inPip) {
            controls.setVisibility(View.GONE);
            playlistPanel.setVisibility(View.GONE);
        } else {
            showControls();
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: togglePlay(); return true;
            case KeyEvent.KEYCODE_MEDIA_NEXT: playRelative(1); return true;
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS: playRelative(-1); return true;
            case KeyEvent.KEYCODE_MEDIA_STOP: stopPlayback(); return true;
            default: return super.onKeyDown(keyCode, event);
        }
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================
    @Override
    protected void onStart() {
        super.onStart();
        attachVideoOutput();
    }

    @Override
    protected void onResume() {
        super.onResume();
        showControls();
    }

    @Override
    protected void onPause() {
        super.onPause();
        // Keep playing in the background via the foreground service.
        if (mp != null && mp.isPlaying()) {
            String t = currentIndex >= 0 && currentIndex < playlist.size()
                    ? displayName(playlist.get(currentIndex)) : "";
            PlaybackService.update(this, mp, t, true);
        }
    }

    @Override
    protected void onStop() {
        super.onStop();
        savePosition();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        savePosition();
        ui.removeCallbacksAndMessages(null);
        if (mp != null) {
            try { mp.stop(); mp.release(); } catch (Exception ignored) {}
            mp = null;
        }
        if (libvlc != null) {
            try { libvlc.release(); } catch (Exception ignored) {}
            libvlc = null;
        }
        engineReady = false;
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle out) {
        super.onSaveInstanceState(out);
        out.putStringArrayList(STATE_PLAYLIST, new ArrayList<>(playlist));
        out.putInt(STATE_INDEX, currentIndex);
        out.putLong(STATE_POSITION, currentPosition);
    }

    static String formatTime(long ms) {
        if (ms <= 0) return "0:00";
        long total = ms / 1000;
        long h = total / 3600;
        long m = (total % 3600) / 60;
        long s = total % 60;
        if (h > 0) return String.format(Locale.US, "%d:%02d:%02d", h, m, s);
        return String.format(Locale.US, "%d:%02d", m, s);
    }
}