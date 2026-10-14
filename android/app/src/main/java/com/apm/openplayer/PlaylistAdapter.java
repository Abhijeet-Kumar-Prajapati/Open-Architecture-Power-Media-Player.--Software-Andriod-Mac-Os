package com.apm.openplayer;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import java.util.ArrayList;
import java.util.List;

/** Playlist rows. Long-press removes, tap plays. */
public class PlaylistAdapter extends RecyclerView.Adapter<PlaylistAdapter.Holder> {

    public interface OnPick {
        void onPicked(String item);
    }

    private final LayoutInflater inflater;
    private final OnPick onPick;
    private List<String> items = new ArrayList<>();
    private int currentIndex = -1;

    public PlaylistAdapter(android.content.Context ctx, OnPick onPick) {
        this.inflater = LayoutInflater.from(ctx);
        this.onPick = onPick;
    }

    public void submit(List<String> newItems, int current) {
        this.items = new ArrayList<>(newItems);
        this.currentIndex = current;
        notifyDataSetChanged();
    }

    public void removeAt(int position) {
        if (position >= 0 && position < items.size()) {
            items.remove(position);
            notifyItemRemoved(position);
        }
    }

    @NonNull
    @Override
    public Holder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        return new Holder(inflater.inflate(R.layout.item_playlist, parent, false));
    }

    @Override
    public void onBindViewHolder(@NonNull Holder holder, int position) {
        String location = items.get(position);
        String name = location;
        int slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
        if (slash >= 0 && slash + 1 < name.length()) name = name.substring(slash + 1);
        try {
            name = android.net.Uri.decode(name);
        } catch (Exception ignored) {}

        holder.name.setText(name);
        holder.index.setText(String.valueOf(position + 1));
        holder.playing.setVisibility(position == currentIndex ? View.VISIBLE : View.GONE);

        int color = position == currentIndex
                ? 0xFF4C8DFF
                : 0xFF8B95AB;
        holder.name.setTextColor(color);

        holder.itemView.setOnClickListener(v -> onPick.onPicked(location));
        holder.itemView.setOnLongClickListener(v -> {
            int pos = holder.getBindingAdapterPosition();
            if (pos != RecyclerView.NO_POSITION) removeAt(pos);
            return true;
        });
    }

    @Override
    public int getItemCount() {
        return items.size();
    }

    static class Holder extends RecyclerView.ViewHolder {
        final TextView name;
        final TextView index;
        final ImageView playing;

        Holder(@NonNull View v) {
            super(v);
            name = v.findViewById(R.id.row_name);
            index = v.findViewById(R.id.row_index);
            playing = v.findViewById(R.id.row_playing);
        }
    }
}