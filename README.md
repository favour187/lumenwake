# LUMENWAKE — The Last Lucid Light

**Reverie Hacks 2026 · Software Development Track**

A third-person 3D action-adventure in the dying dream-city of Reverie. You are the last lantern that still remembers dawn. Collect seven stolen memories, dash the floating isles, and pulse light to banish Night Wraiths before the world unmakes itself.

## Why this project

The hackathon is named *Reverie*. The game *is* a reverie: a lucid dream you can lose. Original generated textures (stone, moss, crystal, wood, sky, lantern, wraiths, orbs, portal, emblem) — no stock asset packs. Playable in one click in the browser.

## Live on Render

This repo is set up as a **Render static site** (`render.yaml`).

**One-click:** [Deploy to Render](https://render.com/deploy?repo=https://github.com/favour187/lumenwake)

Or by hand:

1. Open [dashboard.render.com](https://dashboard.render.com) and sign in (GitHub is fine).
2. **New** → **Blueprint** (or **Static Site**).
3. Connect **favour187/lumenwake**, branch `main`.
4. Publish directory: `.` · Build command can stay empty / `echo "LUMENWAKE static"`.
5. Create. URL will be `https://lumenwake.onrender.com` (or a unique suffix if that name is taken).

Free static sites sleep less than web services and are the right fit here (HTML + JS + images, no Node server).

## Play locally

Open `index.html` via a local static server (required for ES modules):

```bash
npx serve .
# or: python3 -m http.server 8080
```

Then visit the printed URL.

### Controls

| Key | Action |
| --- | --- |
| W / S | Forward / back |
| A / D | Turn |
| Space | Jump |
| Shift | Dash |
| F or Click | Pulse light (banish wraiths) |

**Win:** gather all 7 memories.  
**Lose:** health reaches 0, or fall too often.

## Stack

- Three.js r169 (WebGL, shadows, ACES tone mapping, fog)
- Custom scene: 7 floating isles, bridges, crystal shrine, reflective water, sky dome
- Billboard characters from generated PNG sprites
- Web Audio oscillators (no audio files)
- Combo scoring, invulnerability frames, dash i-frames via timing

## Submission checklist (Devpost)

- [ ] Public GitHub repo + MIT or Apache-2.0 license
- [ ] Demo video ≤ a few minutes (menu → collect → pulse → win)
- [ ] This README as documentation (purpose, audience, install, features)

## Team note

Built as a complete playable vertical slice for a 1–3 person student team. Stretch goals if you have days left: mobile touch, more isles, a final shrine cinematic, and a recorded pitch under 3 minutes.
