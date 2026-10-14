# macOS par APM Open Player — setup guide (हिंदी)

macOS ke liye jo cheezein zaroori hain, wo sirf **ek command** hai. Uske baad app
normal chalega.

---

## Step 1 — Homebrew install karo (sirf ek baar)

Homebrew macOS ka free package manager hai. Agar aapke Mac par pehle se nahi
hai toh:

1. Safari kholein → <https://brew.sh>
2. Wahan di gayi **ek line command** copy karein
3. **Terminal** kholein (Spotlight mein `Terminal` type karein)
4. Command paste karein aur **Enter** dabaayein
5. Password poocha toh apna Mac login password daalein (screen par dikhega nahi)

> Terminal kholne ka tareeka: Spotlight (Cmd+Space) → `Terminal` → Enter

---

## Step 2 — mpv install karo (yeh zaroori hai)

Terminal mein yeh ek line likhein aur Enter dabaayein:

```bash
brew install mpv
```

**Kyun zaroori hai?** APM Open Player ka poora playback engine mpv hai — hi
wahi engine VLC aur MX Player bhi use karte hain. Isi se E-AC-3, TrueHD, DTS,
MKV, AVI, HEVC jaise saare formats chalte hain.

Download hone mein 1–2 minute lagenge. End mein `🍺` ya `Pouring` dikh jaayega
to samajh lena install ho gaya.

---

## Step 3 — App kholein

1. `APM-Open-Player-1.0.0-macos.zip` ko **double-click** karein
2. macOS khud `.app` folder banayega
3. Us `APM Open Player.app` ko **double-click** karein

### ⚠️ "APM Open Player is damaged" ya "cannot be opened" aaya?

Ye **bilkul normal** hai. App unsigned hai (signing certificate nahi hai), isliye
Gatekeeper rok deta hai.

**Fix 1 — ek baar mein (recommended):**

1. `APM Open Player.app` par **right-click** karein
2. **Open** par click karein
3. Ek chhota sa safed dialogue aayega → **Open** par click karein
4. Bas. Ab hamesha normally khulega.

**Fix 2 — Terminal se (agar right-click par "Open" nahi dikhe):**

```bash
xattr -cr "/Applications/APM Open Player.app"
```

> `xattr -cr` ka matlab hai: "is file par laga hua quarantine hatado".
> App ke andar koi virus nahi hai — bas macOS ka default warning hai.

---

## Step 4 — Video chalaayein

- App ke upar **📁 folder icon** click karein → video chunein
- Ya video ko **drag & drop** karein app par
- Ya kisi bhi video par right-click → **Open With** → **APM Open Player**

> **Note:** macOS par video ek **alag window** mein khulta hai aur app ka
> controller window saath mein rehta hai (library, playlist, buttons). Yeh
> normal hai — mpv macOS par apni window banata hai. Playback ke liye
> controller window ka koi use nahi, sirf buttons usi mein hain.

---

## Apple Silicon ya Intel?

Zip mein **dono** architectures shamil hain (universal):

| Mac | Kaam karega |
|---|---|
| M1 / M2 / M3 / M4 (Apple Silicon) | ✅ haan |
| Purane Intel Mac | ✅ haan |

Koi alag download nahi chahiye.

---

## Problem ho toh

| Problem | Solution |
|---|---|
| `brew: command not found` | Step 1 dobara padhein — Homebrew install nahi hua |
| App khulte hi band ho jaata hai | `brew install mpv` zaroor kiya hai? Step 2 dekhein |
| "damaged or incomplete" | Terminal mein `xattr -cr "/Applications/APM Open Player.app"` |
| Video window nahi dikh raha | App ke andar Tools → Preferences → Hardware decoding → `any` |
| Black screen, awaaz aa rahi hai | Preferences → Hardware decoding → `no` (software) |
| Terminal permission error | Mac → System Settings → Privacy & Security → Terminal par click → **Allow** |

---

## Uninstall

1. `APM Open Player.app` ko **Trash** mein phenk dein
2. Terminal mein:
   ```bash
   rm -rf ~/Library/Application\ Support/APM\ Open\ Player
   ```
   (yeh settings aur library hata deta hai)
3. mpv ko hatana ho to: `brew uninstall mpv`

---

## Files kahan hain

| Kya | Kahan |
|---|---|
| App | `APM Open Player.app` (jo zip se nikla) |
| Settings / library | `~/Library/Application Support/APM Open Player` |
| Terminal | Spotlight → `Terminal` |