---
name: webinar-builder
description: Author short cinematic Astria feature-tutorial videos via the /Users/burg/git/astria-course/webinar-builder harness. Use when the user wants a new future video, feature explainer, tutorial, screencast lesson, product walkthrough, or iteration on a short-form Astria module such as 3D packshots, Edit Image, Face Inpainting, Video Style Transfer, or Artboard. Each tutorial is a project under script/projects/project-name.yaml with timed segment YAMLs, contextual Yuli intro, fast output proof, planned screen recording, recap/output review, FAQ/examples, music, SFX, markers, and stitched MP4 output. Ignore the long-form Astria course/webinar as the pattern for new short videos unless the user explicitly asks for that format.
---

# webinar-builder — author short cinematic feature-tutorial videos

The repo at `/Users/burg/git/astria-course/webinar-builder/` is a HyperFrames composition harness. Each short-form tutorial project is a sequence of YAML-driven segments rendered to MP4 and stitched into one draft. This skill is for adding or improving **future Astria feature-tutorial videos** in the same luxe-editorial style.

Before planning a new video, read `references/future-video-guide.md`. It captures the current structure from the short-form examples and intentionally excludes the long-form `webinar` / "Astria course" project as the template.

## When to use

User says any of: *"make a video about <feature>"*, *"new tutorial for X"*, *"build a video segment showing Y"*, *"add a feature explainer"*, *"guide for future videos"*. Each new short-form ask is a project under `script/projects/`.

If the user is iterating on an existing project (just tweaking content, regenerating an asset), don't invent a new project — edit the existing yaml/asset files in place.

---

## Repo layout (must know paths)

```
webinar-builder/
├── script/
│   ├── projects/<name>.yaml         ← project manifest (segments order + defaults)
│   └── segments/<name>/<id>.yaml    ← per-segment config
├── scripts/record/<name>/<id>.ts    ← (optional) Playwright recorder for screencast segments
├── scripts/intent/<name>/<id>.yaml  ← natural-language intent notes (planning only, not consumed by build)
├── layouts/                          ← layouts; see "Visual building blocks"
│   ├── tv-intro.html                ← full-bleed video + serif title cascade
│   ├── video-showcase.html          ← side-by-side result clips + caption
│   ├── face-detail-showcase.html    ← original/final face crops with 100/300/600 zoom proof
│   ├── screencast-pip.html          ← browser mock with screen recording + bullets + avatar PiP
│   ├── presenter-slide.html         ← text slide with avatar + b-roll background
│   ├── avatar-hero.html             ← full-screen avatar with floating slide
│   ├── artboard-tile-review.html    ← tile-by-tile artboard review
│   └── artboard-video-review.html   ← generated video compared to an artboard plan
├── assets/
│   ├── results/<name>/              ← finished demo MP4s (showcase pane sources)
│   ├── avatars/<name>/              ← talking-head + intro video renders
│   ├── audio/<name>/                ← Gemini Aoede narration MP3s (per segment, hash-cached)
│   ├── captures/<name>/             ← Playwright screencast MP4s
│   ├── sfx/                          ← shared SFX library (whoosh, click, ding)
│   └── music/                        ← shared music beds
├── pipeline/                         ← the harness code
└── out/<name>/                       ← rendered per-segment MP4s + _full-draft.mp4
```

**Default project is `webinar`** (backwards-compat). Always pass `--project <name>` to address a non-default project.

CLI entry points:
- `npx tsx pipeline/build.ts --project <name> --segment <id>` — build one segment
- `npx tsx pipeline/build.ts --project <name> --all` — build all
- `npx tsx pipeline/stitch.ts --project <name>` — xfade-stitch into `_full-draft.mp4`
- `npx tsx pipeline/record-screencast.ts --project <name> <id>` — drive a Playwright recorder
- `npm run publish:academy` — safe local-or-GitHub publish helper for the whole Academy site

Flags worth knowing: `DRAFT=1` (silent audio + no avatar/TTS API calls), `NO_AVATAR=1`, `HF_WORKERS=1` (serialize HyperFrames Chromium workers — recommended on this machine), `--rerecord` (force re-record a screencast).

Publishing rule: for the root Academy site, prefer `npm run publish:academy`
or `npm run ci:publish -- root`. A scoped root publish like
`npm run ci:publish -- root --only-project face-inpainting` is only for
refreshing one module's video blobs and must preserve sibling
`videos/<project>/` folders; never let it replace the whole `videos/` tree.
Local `ci:publish` pushes to `gh-pages`; the repo's `pages-deploy.yml` should
then deploy that branch, and `publish:academy` also triggers the deploy action
explicitly for immediate verification.

CI render setup intentionally uses the GitHub runner's system Chrome via
`HYPERFRAMES_BROWSER_PATH`. Do not add `npx playwright install chromium` back
to the shared setup action unless a workflow is genuinely recording live
screencasts; HyperFrames uses Puppeteer/system Chrome, and the Playwright
browser download has timed out after reaching 100%.

The `Publish course` push workflow should render only projects detected by
`npm run ci:affected`; manual dispatch may still render every module. Rendering
unchanged modules on every push is brittle because older modules can reference
ignored/cache media that is only guaranteed to exist when that module is
actually being refreshed.

---

## .env keys (assumed populated)

Documented in `AGENTS.md`. These should be set; don't ask the user:

- `VERTEX_API_KEY` — Gemini TTS (`gemini-3.1-flash-tts-preview`) **and** NanoBanana 3.1 image edits (`gemini-3.1-flash-image-preview`)
- `WAVESPEED_API_KEY` — OmniHuman / InfiniteTalk (regular + fast) avatar lipsync
- `REPLICATE_API_KEY` — Pruna talking-head + file uploads
- `BYTEPLUS_ACCESS_KEY_ID` / `BYTEPLUS_SECRET_ACCESS_KEY` — OmniHuman 1.5 (BytePlus direct)
- `HEYGEN_API_KEY` — HeyGen Avatar IV (legacy fallback)
- `ASTRIA_AUTH_TOKEN` / `ASTRIA_BASE_URL` / `GEMINI_TUNE_ID` / `WORKSPACE_ID` — Astria API for Seedance video gen

---

## Visual building blocks (existing layouts)

Each layout reads template variables that `pipeline/build.ts > renderLayout()` injects. All five accept `{{MUSIC_AUDIO_HTML}}` + `{{SFX_AUDIOS_HTML}}` slots and the project defaults wire `{{BG_LAYER_HTML}}` for `video-showcase` + `presenter-slide`.

| Layout | Use it for | Key yaml fields |
|---|---|---|
| `tv-intro` | 6–10s show open with avatar/Seedance video + serif title lockup | `intro.background_video` (preferred) or `intro.background_image`; `intro.title_html`; `intro.subtitle_html`; `duration: 10.0` |
| `video-showcase` | Side-by-side result clips with caption + headline | `showcase.videos[]` (string or `{src, label}`); `caption.eyebrow` + `caption.html` |
| `face-detail-showcase` | Beauty/face-quality proof: original/final crops, wipe/blink switches, and 100% / 300% / 600% visual zoom labels | `face_showcase.examples[]` with `raw`, `final`, `label`, `raw_callout`, `final_callout`, `start`, `duration`; `caption.{eyebrow,html}` |
| `screencast-pip` | Tutorial: browser mock + Playwright recording + bullets in the right column + tall avatar PiP | `screencast.{mode, url, record_script}`; `slide.bullets` + `slide.bullet_starts`; `markers[]` (luxe-gold SVG overlays at recording-pixel coords); `caption.{eyebrow,html}` |
| `presenter-slide` | Text-bullet slide with avatar + b-roll background | `slide.{eyebrow, title_html, bullets, bullet_starts, columns}` |
| `avatar-hero` | Full-screen avatar with floating slide title | `slide.{eyebrow, title_html}`; uses `avatar` block |
| `artboard-tile-review` | Timed review of specific 4x4 artboard tiles | `review.artboards[]`; `review.tile_beats[]`; `caption.{eyebrow,html}` |
| `artboard-video-review` | Compare a generated video against an artboard plan | `review.videos[]`; `review.artboards[]`; `review.tile_beats[]`; `caption.{eyebrow,html}` |

Schema reference: `pipeline/build.ts > interface SegmentYaml`.

### Project-level defaults (powerful — set once, applies everywhere)

```yaml
# script/projects/<name>.yaml
defaults:
  tts:
    provider: "gemini"
    voice: "Aoede"
    model: "gemini-3.1-flash-tts-preview"
  music:
    src: "assets/music/luxe-pad.mp3"
    volume: 0.12
  background_videos:
    - "assets/results/<name>/clip-1.mp4"
    - "assets/results/<name>/clip-2.mp4"
  avatar:
    image_url: "https://mp.astria.ai/<hash>"         # any segment with avatar PiP slot inherits
    engine: "infinitetalk"                            # regular variant supports 720p + prompt
    resolution: "720p"
    video_prompt: >-
      Subtle natural micro-expressions, calm steady pose, looking at camera,
      no hand gestures, minimal upper-body motion.
```

Visuals **without** an avatar PiP slot (`video-showcase`, `tv-intro`) skip avatar rendering even if defaults.avatar is set.

---

## New tools (built during the video-style-transfer project)

### 1. NanoBanana 3.1 image edit — `pipeline/edit-image-gemini.ts`

Edits an existing image with a text prompt via Vertex AI (`gemini-3.1-flash-image-preview`). Same pattern as `sdbooth/app/models/concerns/vertex_api.rb`. Cached by sha1(source bytes + prompt + aspect).

```
npx tsx pipeline/edit-image-gemini.ts \
  --source <local-path-or-https-url> \
  --prompt "<edit instruction>" \
  --output <path.jpg> \
  [--aspect-ratio 3:4|16:9|1:1|...] \
  [--upload]      # also POST to tmpfiles.org and print a fetchable public URL
```

Use for: turning a head-only headshot into full-body, generating a "last frame" pose, creating cover images for showcase panes, restyling references. Identity preservation is generally good if you say "preserve the exact face/hair/skin tone/identity from the source".

### 2. Astria Seedance video — `pipeline/generate-seedance-astria.ts`

First-frame (+ optional last-frame) image-to-video via Astria's `/tunes/:id/prompts` endpoint.

```
npx tsx pipeline/generate-seedance-astria.ts \
  --output <path.mp4> \
  --first <path.jpg> \
  [--last <path.jpg>] \
  --prompt "<faceid:NNNN:1.0> woman. <motion description>" \
  [--model seedance2_720p]   # default seedance_v15_720p. seedance2_fast_720p does NOT support last-frame; seedance2_720p does
  [--duration 6|10|...]      # 4-12s for v15; 4-15s for seedance2_*
  [--aspect 16:9]
```

Important constraints (verified live):
- **`seedance2_fast_720p` does NOT accept `video_last_frame`** — Astria returns `422: "video_last_frame is not supported for video model seedance2_fast_720p"`. Use `seedance2_720p` (non-fast) for first+last frame interpolation.
- The `<faceid:NNNN:1.0> woman` syntax goes in `--prompt` (Astria's `prompt[video_prompt]`). It attaches a face reference for identity preservation across the generated video. Get the faceid from the Astria UI or `astria-api` skill.
- Response shape: parallel `images[]` + `content_types[]` arrays. The video URL is at the index where `content_types[i].startsWith("video/")`.
- After download, **always re-encode** with `ffmpeg -c:v libx264 -r 30 -g 30 -keyint_min 30 -an` to fix sparse keyframes hyperframes complains about, and strip audio (we have music + SFX layers handling sound).

### 2b. GPT Image 2 artboard to Seedance intro

For highly contextual intros, especially when the user asks for a more cinematic
opening idea, use the `astria:artboard` skill before the video pass:

1. Keep the artboard aspect ratio identical to the project output. The current
   short-form builder renders 1920x1080, so use `--aspect-ratio 16:9` unless
   the project manifest or user brief says otherwise.
2. Inventory the active workspace references with `astria prompts list`, then
   `astria tunes get` for the useful IDs. For this course, Yuli remains the
   presenter; if a Yuli tune exists, use `<faceid:...:1.0> woman` for her.
3. Write 16 numbered shots with alternating camera scales. Generate the board:

   ```bash
   astria generate -w <workspace> --model gpt-image-2 \
     --aspect-ratio 16:9 --num-images 1 --text "<16 numbered shots>" --wait
   ```

4. Generate the intro video with the same 16 numbered shots as
   `--video-prompt`, prefixed by `A cinematic video with the below video shots.`
   Use shot 1 verbatim as `--text`. Do not pass the artboard grid image as
   `--first-frame` or `--input-image`; that makes the grid animate in place.

   ```bash
   astria video -w <workspace> --video-model seedance2_720p \
     --aspect-ratio 16:9 --num-images 1 --duration 10 \
     --text "<shot 1 verbatim>" \
     --video-prompt "A cinematic video with the below video shots.
   1) <shot 1>
   ...
   16) <shot 16>" --wait
   ```

5. Download the finished prompt and re-encode the MP4 before wiring it into
   `intro.background_video`.

### 3. SFX layer — synthesized in repo, embedded per segment

The three reusable SFX clips at `assets/sfx/` were generated with ffmpeg `anoisesrc` / `sine` filters and live in repo:

- `whoosh-soft.mp3` — ~0.6s pink-noise sweep with bandpass + envelope
- `click-subtle.mp3` — ~50ms 2.2kHz sine tick (UI tap)
- `ding-soft.mp3` — ~0.45s 1318Hz fundamental + 2637Hz harmonic chime (bullet pop)

Drop them into a segment with the `sfx[]` field — `pipeline/build.ts > renderLayout()` injects each as an `<audio class="clip">` at the configured start.

```yaml
sfx:
  - { src: "assets/sfx/whoosh-soft.mp3", start: 0.2, volume: 0.55 }
  - { src: "assets/sfx/ding-soft.mp3",   start: 3.0, volume: 0.45 }
  - { src: "assets/sfx/click-subtle.mp3", start: 3.2, volume: 0.5 }
```

To synthesize more SFX, use the ffmpeg recipes in this skill or inspired by them — synthetic gives consistent levels and avoids freesound auth.

### 4. Music bed — synthesized ambient pad

`assets/music/luxe-pad.mp3` — 3-minute loop of 6 stacked detuned sines at chord intervals, low-pass + vibrato + fade-in/out. Volume ducked to 0.12 under the Aoede narration. Set once in `defaults.music`; per-segment `music: null` disables.

### 5. Marker highlights on screencast — luxe-gold SVG strokes

For `screencast-pip` segments. Each marker is an SVG `<ellipse>` / `<path>` overlayed on the recording at source-video coordinates (1600×900 for our Playwright captures). GSAP animates `stroke-dashoffset` from 1→0 to draw, holds, then fades.

```yaml
markers:
  - { start: 3.0,  duration: 4.0, shape: circle,    cx: 260, cy: 145, r: 70,  style: luxe-gold }
  - { start: 14.0, duration: 4.0, shape: underline, cx: 800, cy: 720, w: 700, style: luxe-cream }
  - { start: 38.0, duration: 6.0, shape: arrow,     cx: 1290, cy: 250, w: 140, h: 30 }
```

`luxe-gold` = `#D9B97A` stroke 5px, `luxe-cream` = `#F4F1EC` stroke 4px. Coords are eyeballed against one frame of the recording — render once and adjust.

### 6. Crossfade stitch — `pipeline/stitch.ts`

Default 0.4s xfade between successive clips. Pass `--no-xfade` for legacy concat, or `--fade <seconds>` to tune.

---

## Authoring a new tutorial — recipe

The user just said *"make a video about feature X"*. Here's the playbook:

### Step 1 — Read the guide and plan the arc

Read `references/future-video-guide.md`, then draft the segment list before editing YAML. Use this canonical arc unless the feature truly needs a longer artboard-style walkthrough:

1. **Contextual Yuli intro** (`tv-intro`, 8–12s) — Yuli appears in a real-life context tied to the feature, with a short generated intro music cue or project music bed. Use Yuli's identity; vary the environment and product context, not the presenter.
2. **Fast output proof** (`video-showcase`, `face-detail-showcase`, 25–45s) — lead with finished outputs, input-vs-output comparison, zoom/crop/stress moments, labels, and energetic SFX so viewers understand the payoff before the workflow. Use several quick examples instead of stretching one comparison.
3. **Why it matters / use cases** (`presenter-slide`, `comparison`, 20–35s) — place value framing after some proof and before the workflow. This is where business context, creative scenarios, limitations, pricing/time implications, and identity/reference behavior belong.
4. **Get to work** (`screencast-pip`, 30–55s per flow) — plan the recording first, clean the UI state, prepare assets, trim waiting, zoom/highlight relevant areas, sync bullets to narration, and keep Yuli in PiP.
5. **Output review / recap** (`video-showcase`, `artboard-*review`, or `presenter-slide`, 20–40s) — show what was created, compare it with the starting input or plan, and make the added value explicit.
6. **FAQ / constraints** (`presenter-slide` with animated background examples, 25–35s) — answer when to use it, limitations, prep requirements, best prompts, costs/formats, and concrete scenarios. Keep visual examples moving behind or beside the answers.

Target ≈ 120–180s for a tight module. For a proof-heavy feature refresh, 2:10–2:30 is often the sweet spot; tighten narration or collapse repetitive sections if the stitched draft drifts past that. Longer multi-step topics like Artboard may run 5–7 minutes, but still need result proof early and review beats between workflows.

Timing heuristics for a first draft:
- Intro: 8–10s.
- Proof/examples: 30–45s for 3–4 quick examples.
- Why/use cases: 25–35s.
- Workflow: 30–45s for one focused flow.
- FAQ: 25–32s.

Treat YAML `duration` as the intended visual floor, not the final runtime. Narration, avatar timing, and media can extend a segment. Estimate narration around 2.3–2.6 words/sec plus a short tail; when a DRAFT build says audio exceeds the segment, tighten the script before adding more seconds.

Avoid holding one static page, slide, or example longer than 25–30s. Add crops, wipes, toggles, pans, or another example instead.

### Step 2 — Source assets (parallel work)

- **Result clips**: ask the user for 1–2 finished MP4s of the feature output (or generate via Astria), drop into `assets/results/<project>/`. Re-encode with GOP=30 `-an`.
- **Avatar — always Yuli, the course's one presenter. Never cast a new face.**
  The series uses a SINGLE recurring presenter across every module. Do not
  generate, restyle, or invent a presenter per project — reuse Yuli verbatim:
  1. `defaults.avatar.image_url` → `assets/avatars/yuli.jpg`, the committed,
     in-repo presenter headshot (`build.ts` inlines a repo-relative image as a
     base64 data URI for the lipsync API). Don't use external image-host URLs.
  2. Intro footage should be contextual. Generate or reuse a Yuli intro where the environment demonstrates the feature: 3D products rotating around her, an edit wall, a director's table of artboards, a beauty retouch setup, etc. Use Yuli source material from `assets/avatars/video-style-transfer/` or `assets/avatars/yuli.jpg` as the identity reference, and save the module-specific intro under `assets/avatars/<project>/`.
  3. Do NOT use `unique-headshot` or invent a new presenter. If using `edit-image-gemini.ts` or Seedance to make intro material, preserve Yuli's exact identity and only change scene/action/wardrobe when the user asks.
- **Screencast recording**: write `scripts/record/<project>/02-workflow.ts` modeled on `scripts/record/video-style-transfer/02-workflow.ts`. Forgiving selectors with short timeouts. Run with `HEADED=1` to iterate live.
  - **Dismiss top banners first.** Astria pages can render dismissible alert/info/banner strips at the top (announcements, "verify email", upgrade nudges, balance warnings, etc.). They eat vertical pixels and ruin the framing. Every recorder should call a `dismissBanners(page)` helper **after each navigation** (and again after opening the AI chat) that finds `.alert, .banner, [role=alert], [class*='announce'], [class*='notification']` near the top with a visible close button (`button[aria-label*='close' i]`, `.btn-circle.btn-ghost`, `.close`, `[data-action*='close']`) and clicks it. Be tolerant — no banner is the common case; the helper should be a silent no-op. Pattern lives in `scripts/record/workspace-public-page/02-workflow.ts`.
  - **Use a zoom ladder for detail-proof demos.** If the feature claims better
    texture, typography, faces, edges, or product detail, show the proof at
    normal scale, then 300% and 600%. Reserve 1000% for rare cases where the
    detail still reads cleanly. In real UI recordings, use the app's native
    zoom/lightbox controls and add a small captured overlay badge if the UI
    does not display the current zoom clearly. In HyperFrames-only proof
    segments, animate the crop scale and label each beat so the viewer knows
    what is being inspected. Zoom numbers can appear as temporary visual
    badges, but do not put them in narration or slide bullets unless the video
    is explicitly teaching zoom controls.

### Step 3 — Wire it up

Create:
- `script/projects/<name>.yaml` — manifest with `defaults.music`, `defaults.background_videos`, `defaults.avatar` (image_url + engine: infinitetalk + video_prompt), and `segments: [...]` ordered list.
- `script/segments/<name>/00-intro.yaml`, `01-showcase.yaml`, `02-workflow.yaml`, optionally `02b-<concept>.yaml`, `03-faqs.yaml`.
- `scripts/intent/<name>/<id>.yaml` before any difficult recorder. Capture URL, required auth, viewport, duration, narration anchors, target selectors, prepared assets, and whether to click Generate or jump to a precomputed result.
- `scripts/record/<name>/<id>.ts` only after the intent is clear. The recorder should feel like a human walkthrough: glides, holds, typed prompts, prepared uploads, zoom for legibility, trimmed waits, no stale drafts.

Each segment yaml: `id`, `title`, `visual`, the layout-specific fields, `narration:` (multi-line), per-segment `sfx[]` if extra punctuation needed.

Before writing narration or slide labels, separate **production notes** from
**viewer-facing language**. Keep prompt IDs, model IDs, internal layer names,
debug labels, recorder zoom percentages, and implementation details in
recorder constants/comments or intent notes only. Prefer audience-facing labels:
`Original`, `First render`, `Final`, `Before`, `After`, `Reference`, `Result`.
If a workflow preserves identity from a reference, say that plainly; do not let
it sound like generic skin smoothing or a mystery model swap.

Run a quick copy scan before building a full draft:

```bash
rg -n "debug layer|debug label|raw pass|PROMPT [0-9]|prompt id|dedicated face model|face model|same wardrobe|whichever|100%, 300%, and 600%|one hundred|three hundred|six hundred" script/segments/<project-name> script/projects/<project-name>.yaml
```

Adapt the terms to the project. The goal is to catch production-plan language
that accidentally leaked into the viewer experience.

### Step 4 — Iterate per segment

```
DRAFT=1 HF_WORKERS=1 npx tsx pipeline/build.ts --project <name> --segment 01-showcase
open out/<name>/01-showcase.mp4
```

Refine the yaml, re-render. DRAFT mode uses silent audio + no avatar so iteration is fast.

When the layout looks right, build with real TTS:

```
HF_WORKERS=1 npx tsx pipeline/build.ts --project <name> --segment 02-workflow
```

### Step 5 — Stitch

```
DRAFT=1 HF_WORKERS=1 npx tsx pipeline/build.ts --project <name> --all
npx tsx pipeline/stitch.ts --project <name>
open out/<name>/_full-draft.mp4
```

Use real TTS/avatar only after the draft timing and visuals are approved.

---

## Style guide — luxe editorial

The whole pipeline is tuned for a luxe fashion-editorial aesthetic: Playfair Display headlines, muted gold accent (`#D9B97A`), warm gray studio backgrounds, slow GSAP easings, ambient pad music, restrained SFX (no Mr.Beast punch).

**One presenter for the whole course — Yuli. Never cast a new face per video.**
The series has a single recurring presenter; a new face per module breaks
continuity. Reuse Yuli's identity in every project:

- `defaults.avatar.image_url` → `assets/avatars/yuli.jpg` (committed in-repo headshot — `build.ts` inlines a repo-relative path as a base64 data URI; no external image host)
- Intro footage → prefer a contextual real-life Yuli scene tied to the feature. Use the shared Yuli headshot/source frames for identity; save project-specific intro media under `assets/avatars/<project>/`.
- Do **not** reach for `unique-headshot` or cast a new face. The environment, props, b-roll, examples, and music can change; the presenter remains Yuli.

What varies per project is the **set dressing**, not the presenter: the screencast content, slide backdrops, b-roll result clips, caption copy, and music/SFX tonality.

**Audio tonality can vary** subtly between projects — a punchier project might pull SFX volumes up to 0.6+, a more meditative one keeps them around 0.4 and lengthens the music tail.

---

## Verification (always run before declaring done)

1. **Lint** — `npx hyperframes lint` (zero errors; 5 warnings about draft caption divs are pre-existing).
2. **Single-segment renders** look right in `out/<project>/<id>.mp4`.
3. **Audio levels** — `ffmpeg -i out/<project>/_full-draft.mp4 -af volumedetect -vn -f null - 2>&1 | grep mean_volume` should land between -22 dB and -12 dB. Higher → SFX are too loud. Lower → music too quiet.
4. **Full stitch** — `out/<project>/_full-draft.mp4` plays end-to-end without hard cuts.
5. **Duration check** — `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 out/<project>/_full-draft.mp4`; tighten if a short module drifts beyond the target range.
6. **Review frames** — extract stills from intro, proof/examples, why/use cases, workflow, and FAQ. Confirm the first workflow frame is loaded, labels are viewer-friendly, and the final proof is visible.
7. **Source hygiene** — HyperFrames renders may temporarily rewrite `webinar-builder/index.html`. Restore it before staging unless the source edit was intentional.

---

## What NOT to do

- Don't invent a new layout when an existing one will do — modify yaml first, only add a new layout if the composition genuinely needs new structure.
- Don't hardcode tmpfiles.org URLs in committed yamls (they expire ~1h). Use `mp.astria.ai/...` URLs for hosted images, or re-upload on each build.
- Don't `git add` files matching `assets/avatars/**/*.mp4` or `assets/captures/**/*.mp4` — these are gitignored, large, and re-generatable. The .gitignore patterns are authoritative.
- Don't run `pipeline/build.ts --all` for iteration — it costs API $$$. Use `--segment <id>` for the one you're touching, plus `DRAFT=1` for layout/copy iteration.
- Don't seedance2_fast_720p when you need last_frame. Use seedance2_720p.
- Don't expose prompt IDs, model IDs, debug layers, or implementation labels in narration, slide bullets, captions, or visible comparison labels.
- Don't narrate zoom percentages just because the recorder uses them as construction notes.
- Don't frontload abstract overview copy before the viewer has seen proof; show the result, explain why it matters, then teach the workflow.

---

## Reference projects (read these for examples)

- `script/projects/3d-packshots.yaml` — strongest input-to-output promise, 3D rotation proof, business-value recap, and stitched music bed.
- `script/projects/edit-image.yaml` — clean two-workflow structure, minimal prompts, strong "prep step" FAQ.
- `script/projects/face-inpainting.yaml` — real UI flow, proof examples before workflow, zoomed composer, jump from Generate to completed prompt, Original/Final comparison, identity-preserving FAQ copy.
- `script/projects/video-style-transfer.yaml` — compact luxe-editorial tutorial with markers and a first-frame teaching beat.
- `script/projects/artboard-2.yaml` — longer multi-step example with repeated workflow/review beats.

Do not use `script/projects/webinar.yaml` or `script/segments/webinar/` as the pattern for future short videos. That is the long-form Astria course/webinar; inspect it only when the user explicitly asks for a long-form course or when borrowing a narrow recorder technique.

Read the existing short-form yaml first when starting a new project — copy the manifest defaults block, then customize.
