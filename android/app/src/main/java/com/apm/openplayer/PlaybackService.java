package com.apm.openplayer;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;

import org.videolan.libvlc.MediaPlayer;

/**
 * Keeps playback alive when APM leaves the foreground (screen off, another app
 * in front). Without this Android kills the process seconds after onPause,
 * which makes the app useless for music, audio books and radio.
 *
 * This is a started service, not a bound one: the activity owns the
 * MediaPlayer and pushes state changes in through intents. A static reference
 * is kept only so the notification can read the live playback position.
 */
public class PlaybackService extends Service {

    public static final String CHANNEL_ID = "apm_playback";
    private static final int NOTIFICATION_ID = 4201;

    public static final String ACTION_UPDATE = "com.apm.openplayer.UPDATE";
    public static final String ACTION_STOP = "com.apm.openplayer.STOP";
    private static final String EXTRA_TITLE = "title";
    private static final String EXTRA_PLAYING = "playing";

    /** Live player reference so the notification can show real progress. */
    private static MediaPlayer currentPlayer;
    private static String currentTitle = "";

    public static void update(Context ctx, MediaPlayer player, String title, boolean playing) {
        currentPlayer = player;
        currentTitle = title == null ? "" : title;
        Intent i = new Intent(ctx, PlaybackService.class)
                .setAction(playing ? ACTION_UPDATE : ACTION_STOP)
                .putExtra(EXTRA_TITLE, currentTitle)
                .putExtra(EXTRA_PLAYING, playing);
        if (playing) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(i);
            } else {
                ctx.startService(i);
            }
        } else {
            ctx.startService(i);
        }
    }

    public static void stop(Context ctx) {
        ctx.startService(new Intent(ctx, PlaybackService.class).setAction(ACTION_STOP));
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_STOP : intent.getAction();
        boolean playing = intent != null && intent.getBooleanExtra(EXTRA_PLAYING, false);

        if (ACTION_STOP.equals(action) || !playing) {
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        currentTitle = intent.getStringExtra(EXTRA_TITLE);
        if (currentTitle == null) currentTitle = "";

        createChannel();
        Notification n = buildNotification();
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        stopForeground(true);
        super.onDestroy();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, getString(R.string.playback_channel), NotificationManager.IMPORTANCE_LOW);
        ch.setShowBadge(false);
        ch.setSound(null, null);
        nm.createNotificationChannel(ch);
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        PendingIntent contentIntent = PendingIntent.getActivity(
                this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        long position = 0;
        long length = 0;
        if (currentPlayer != null) {
            try {
                position = currentPlayer.getTime();
                length = currentPlayer.getLength();
            } catch (Exception ignored) {}
        }

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_play)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(currentTitle)
                .setSubText(MainActivity.formatTime(position))
                .setContentIntent(contentIntent)
                .setOngoing(true)
                .setSilent(true)
                .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

        if (length > 0 && position >= 0) {
            b.setProgress((int) length, (int) position, false);
        }
        b.setStyle(new MediaStyle().setShowActionsInCompactView(0));
        return b.build();
    }
}