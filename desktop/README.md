# NeuroGen Studio — Desktop App

## What this is
A full **Electron desktop application** that runs the exact same NeuroGen Studio interface on your PC.

You get **two modes** — switchable with a click inside the app:

| Mode | Where it runs | Speed | Videos saved at |
|------|--------------|-------|-----------------|
| 🌐 **Railway** | Cloud (Railway server) | Depends on Railway | Railway server |
| 🖥️ **Local PC** | Your own PC | Full local speed | `server/output/` |

---

## How to launch

**Option 1 — Double-click launcher (easiest):**
```
Double-click:  "Launch NeuroGen Studio.bat"
```

**Option 2 — Command line:**
```powershell
cd desktop
npm start
```

---

## Switching between Railway and Local PC

Once the app opens, you'll see a **mode switcher** in the top-right of the navbar:

```
[ 🌐 Railway ] [ 🖥️ Local PC ] ●
```

- Click **Railway** → uses the live Railway cloud server
- Click **Local PC** → starts the local Node.js server on your PC at `http://localhost:5001`
- The green dot (●) means the server is online and ready

When **Local PC** mode is active, a green banner appears below the navbar:
```
🖥️ Running on Local PC — Output saved to server/output/   [📁 Open Output Folder]
```

---

## Local PC output location

All generated videos (in Local PC mode) are saved to:
```
E:\.0\video-gen-app\server\output\
```

Click **📁 Open Output Folder** in the app to open it directly in File Explorer.

---

## Requirements

- ✅ Node.js installed (you have it)
- ✅ FFmpeg installed at `C:\ffmpeg\bin\ffmpeg.exe` (you have v8.1.1)
- ✅ API keys already in `server/.env`
- ✅ `cd desktop && npm install` (done)

---

## First-time setup (already done for you)
```powershell
cd E:\.0\video-gen-app\desktop
npm install
```
