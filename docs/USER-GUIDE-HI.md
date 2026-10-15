# APM Open Player — शुरू कैसे करें (हिंदी गाइड)

यह गाइड उसके लिए है जिसे कोड से नहीं, सीधे **चलाना** है। कोई technical
जानकारी नहीं चाहिए।

---

## भाग 0 — सबसे पहले: कौन सी file लेनी है?

एक zip है जिसमें तीनों platforms के installers हैं (~525 MB):

**APM-Open-Player-1.0.0-ALL-IN-ONE.zip**

Mobile data par hai? **Poora mat lo.** Neeche har platform ka file alag se
bhi rakha hai — sirf wahi utaaro jo chahiye.

| Aapka device | Bas yeh utaaro |
|---|---|
| Windows PC | `APM-Open-Player-1.0.0-Windows-x64-Setup.exe` (174 MB) |
| Mac (M1/M2/M3/M4) | `APM-Open-Player-1.0.0-macos-arm64.zip` (125 MB) |
| Mac (purana Intel) | `APM-Open-Player-1.0.0-macos-x64.zip` (129 MB) |
| Android phone | `APM-Open-Player-1.0.0.apk` (96 MB) |

---

## भाग 1 — Windows par

### Install karke chalana (sabse aasan)

1. File Explorer kholein (Windows key daba kar `E` likhein)
2. Is path par jaayein:

   ```
   C:\Users\abhij\OneDrive\Documents\Default Project\APM-Open-Player\release
   ```

3. Is file par **double-click** karein:

   ```
   APM-Open-Player-1.0.0-Windows-x64-Setup.exe
   ```

4. Windows SmartScreen aaye to:
   - **More info** par click karein
   - phir **Run anyway** par click karein

   (Yeh isliye aata hai kyunki app abhi signed nahi hai. Yeh surakshit hai.)

5. Installer khulega:
   - **Next** → **Next** → **Install** → **Finish**
6. App khud khul jayega ✅

> Install karne par **Start Menu** aur **Desktop** par shortcut apne aap ban
> jata hai. Uske baad app ko kabhi bhi wahin se khol sakte hain.

> **Mobile data bachana hai?** Setup exe 174 MB ka hai. Install hone ke baad
> app sirf ~5 MB jagah leta hai — baar baar download karne ki zaroorat nahi.

### App mein pehla video chalana

1. App khulne par left side mein **Library** dikhega (khali hai)
2. Upar **＋** dabayein → apne videos ka folder chunein
3. App us folder ki har video dhoondh lega
4. Left side se koi video par click karein — chalne lagegi

Ya seedha: kisi bhi video file par **double-click** karein.

---

## भाग 2 — Android par

### APK bhejna

1. `APM-Open-Player-1.0.0.apk` ko apne phone par bhejein
   - **WhatsApp** par bhej sakte hain (15 MB ki limit nahi hai file ki)
   - ya **Google Drive** / **Telegram** par bhej kar download karein
   - ya phone mein **USB cable** se copy karein

### Install karna

1. Phone mein **Files** app kholein aur woh APK dhoondhein
2. Us par tap karein
3. Phone poochega: *"Is app ko install karne ki ijazat hai?"*
4. **Settings** par tap karein → **Install unknown apps** → **Allow**
5. Wapas aakar **Install** dabayein

> **"Install anyway"** ya **"Allow from this source"** dikhe to us par bhi
> tap karna hoga. Yehi pehli baar hota hai.

### Phone par video kholna

- App kholein → **＋** dabayein → video chunein
- Ya kisi bhi video file par tap karein → **Open with** → **APM Open Player**

> **x86 emulator wala note:** yeh APK sirf ARM phones ke liye hai (99% phones).
> Emulator pe chalane ke liye code se dobara banana padega.

---

## भाग 3 — macOS par

### Setup

1. Apne Mac wala zip kholein:
   - **M1/M2/M3/M4** → `macos-arm64.zip`
   - **Purana Intel Mac** → `macos-x64.zip`
2. Usme mile `APM Open Player.app` ko **drag** karke
   **Applications** folder mein chhod dein

### Pehli baar chalane se pehle (zaroori)

Terminal (Terminal.app) kholein aur yeh likhein:

```bash
brew install mpv
```

> Mac par mpv ka official ready-made version nahi hota, isliye wo install karna
> padta hai. Ek baar kar lo, phir hamesha ke liye set ho jayega.

### Chalana

- **Applications** se app kholein
- Pehli baar Gatekeeper warning aayegi → **right-click** → **Open** →
  **Open** confirm karein

> Yehi tab hota hai jab app signed nahi hai. Har baar nahi aayegi.

---

## भाग 4 — app kaise dikhta hai

```
┌──────────────────────────────────────────────────────────────┐
│ ▶ APM Open Player      [ Search or paste a URL ]    ─ □ ✕    │  ← Title bar
├────────────┬─────────────────────────────────────────────────┤
│  Library   │                                                 │
│  Playlist  │                                                 │
│  Recent    │            V I D E O   A R E A                  │  ← yahaan video chalega
│            │                                                 │
│  ┌──────┐  │                                                 │
│  │ Add  │  │                                                 │
│  │folder│  │                                                 │
│  └──────┘  │                                                 │
├────────────┴─────────────────────────────────────────────────┤
│ video.mp4  MKV • H.265 • 1920×1080 • E-AC-3 • 1:42:10        │  ← file ki info
│ 0:05 ──────────●───────────────────────────── 1:42:10          │
│  ⏮  ▶  ⏭            🔁 🔀            🔊──●──  ⋯  ⛶             │  ← Buttons
└──────────────────────────────────────────────────────────────┘
```

### Buttons ka kaam

Bar par sirf **7 buttons** hain — jitne ki roz zaroorat padti hai. Baaki sab
**⋯ (teen dot)** menu mein hai, ek click mein.

| Button | Kaam |
|---|---|
| ⏮ | Pichhli video |
| **▶ / ⏸** | **Chalao / rok do (ya `Space` dabayein)** |
| ⏭ | Agli video |
| 🔁 | Loop — off / poori list / ek hi video |
| 🔀 | Shuffle (random order) |
| 🔊 | Awaaz — uske baad slider aayega |
| **⋯** | **Baaki sab kuch (neeche dekhein)** |
| ⛶ | Fullscreen |

### ⋯ menu mein kya kya hai

| Menu item | Kaam |
|---|---|
| Jump back / forward 10s | Tez seek |
| Stop | Band karo |
| Playback speed | 0.25× se 4× tak |
| Subtitles | Track badlein ya nayi file add karein |
| Audio track | Multi-audio movies mein badlein |
| Video track | Multi-video files mein badlein |
| Take snapshot | Photo khichhein |
| Mini player | Chhota window (picture-in-picture) |
| Convert file | Format badlein (remux ya naya encode) |
| Effects | Brightness, equalizer, subtitle size |
| Add file / folder / stream | Naya media daalo |
| Settings | Saari settings |
| Keyboard shortcuts | Saare shortcut ki list |
| Supported formats | Kaun sa format chalta hai |

### Keyboard shortcuts (sirf PC par)

| Key | Kaam |
|---|---|
| `Space` | Play / Pause |
| `←` `→` | 10 second peeche / aage |
| `↑` `↓` | Volume badhayein / ghatayein |
| `M` | Mute |
| `F` | Fullscreen |
| `N` / `P` | Agli / pichhli video |
| `S` | Stop |
| `B` | Audio track badlein |
| `J` | Subtitle track badlein |
| `Ctrl + O` | File kholein |
| `Ctrl + L` | Subtitle file add karein |
| `Ctrl + E` | Effects |
| `Ctrl + B` | Sidebar chhupayein / dikhayein |

Video par **mouse se click** = play/pause, **double click** = fullscreen,
**wheel** = volume.

---

## भाग 5 — kuch aur zaroori baatein

### Subtitles kaise daalein

- `Ctrl + L` dabayein → `.srt` ya `.ass` file chunein
- (Phone par: ⋯ menu → Subtitles)
- Agar video ke naam jaisi subtitle file usi folder mein rakhi hai, to
  **apne aap** lag jayegi

### Library (apni saari videos ek jagah)

- Left side → **Library** tab
- Upar **＋** dabayein → folder chunein
- App us folder ki har video dhoondh lega aur thumbnails banayega

### Jahaan yaad rakha jata hai

| Kya | Kahan |
|---|---|
| Video kahan chhodhi thi | Har video ke liye alag — agli baar wahin se chalega |
| Settings, library | App ke andar, khud save hote hain |
| Screenshots | Pictures folder ke andar |

### Kuch formats jo zyada tar apps nahi khol paate

| Format | Kahan milta hai |
|---|---|
| `E-AC-3` (Dolby Digital Plus) | Netflix / YouTube ki movies |
| `TrueHD`, `DTS` | Blu-ray, kiya hua HD audio |
| `APE`, `WavPack` | Lossless music (CD se behtar) |
| `.ts`, `.m2ts` | Camera recordings, TV dumps |
| `HEVC` 4K | Blu-ray rip, YouTube 4K |
| `AV1` | Latest hi-res streams |

In sab isliye chal jaate hain kyunki app FFmpeg use karta hai, phone ka
built-in player nahi.

---

## Problem ho to?

| Problem | Solution |
|---|---|
| Video black dikh rahi, awaaz aa rahi hai | ⋯ → Settings → Hardware decoding → **Disabled** |
| APK install nahi ho raha | Settings → Install unknown apps → **Allow** |
| App bahut slow lag raha | ⋯ → Settings → Hardware decoding → **any** (default) |
| Subtitles nahi dikh rahe | Video ke naam jaisi `.srt` file usi folder mein rakhein |
| Koi format nahi chal raha | ⋯ → **Supported formats** dekhein; report dein |
| Mac par app khul hi nahi raha | Terminal mein `brew install mpv` chalaya? Pehle yeh karein |

---

## GitHub pe upload kaise karein

Detail: [`docs/RELEASING.md`](RELEASING.md)

Sabse aasan — website se:

1. GitHub par apna repository kholein
2. **Releases** tab → **Draft a new release** par click karein
3. **Choose a tag** → naya tag likhein `v1.0.0` → **Create new tag**
4. Upar title likhein: `APM Open Player 1.0.0`
5. Neeche **Upload files** → yeh files chunein `release/` folder se:
   - `APM-Open-Player-1.0.0-ALL-IN-ONE.zip`
   - (ya, agar kam size chahiye to sirf ek platform ka file)
   - `APM-Open-Player-1.0.0-source.zip`
6. **Publish release** dabayein

> **Zaroori:** binaries ko kabhi bhi **commit** mat karein. Git 100 MB se bada
> file reject kar deta hai. Release mein 2 GB tak allowed hai. Source code
> (360 KB) hi commit hota hai.