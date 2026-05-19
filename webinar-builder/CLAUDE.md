# HyperFrames Composition Project

## Skills — USE THESE FIRST

**Always invoke the relevant skill before writing or modifying compositions.** Skills encode framework-specific patterns (e.g., `window.__timelines` registration, `data-*` attribute semantics, shader-compatible CSS rules) that are NOT in generic web docs. Skipping them produces broken compositions.

| Skill               | Command            | When to use                                                                                       |
| ------------------- | ------------------ | ------------------------------------------------------------------------------------------------- |
| **hyperframes**     | `/hyperframes`     | Creating or editing HTML compositions, captions, TTS, audio-reactive animation, marker highlights |
| **hyperframes-cli** | `/hyperframes-cli` | CLI commands: init, lint, preview, render, transcribe, tts                                        |
| **gsap**            | `/gsap`            | GSAP animations for HyperFrames — tweens, timelines, easing, performance                          |

> **Skills not available?** Ask the user to run `npx hyperframes skills` and restart their
> agent session, or install manually: `npx skills add heygen-com/hyperframes`.

## Commands

```bash
npx hyperframes preview          # preview in browser (studio editor)
npx hyperframes render       # render to MP4
npx hyperframes lint         # validate compositions (errors + warnings)
npx hyperframes lint --verbose  # include info-level findings
npx hyperframes lint --json     # machine-readable output for CI
npx hyperframes docs <topic> # reference docs in terminal
```

## Documentation

**For quick reference**, use the local CLI docs command (no network required):

```bash
npx hyperframes docs <topic>
```

Topics: `data-attributes`, `gsap`, `compositions`, `rendering`, `examples`, `troubleshooting`

**For full documentation**, discover pages via the machine-readable index — do NOT guess URLs:

```
https://hyperframes.heygen.com/llms.txt
```

## Environment

`.env` (gitignored) holds the working API keys for this project — `dotenv/config` loads them automatically in `pipeline/*.ts`. **Assume they're set; don't ask the user to provide them.** Currently populated:

- `VERTEX_API_KEY` — Gemini TTS (default narration path)
- `HEYGEN_API_KEY` — HeyGen Avatar IV fallback
- `REPLICATE_API_KEY` — Pruna AI talking-head + file uploads
- `BYTEPLUS_ACCESS_KEY_ID` / `BYTEPLUS_SECRET_ACCESS_KEY` — OmniHuman 1.5 (BytePlus)
- `WAVESPEED_API_KEY` — OmniHuman v1/v1.5 + InfiniteTalk (regular & fast) via WaveSpeed

Override behavior with env flags rather than editing keys: `DRAFT=1` skips paid APIs, `NO_AVATAR=1` skips talking heads, `TTS_PROVIDER=inworld` switches off the default Gemini path, `HF_WORKERS=1` serializes hyperframes rendering.

## CI & previews

This repo runs in GitHub Actions (`.github/workflows/`). When acting on a PR:

- **PRs build in DRAFT** — `pr-build.yml` renders affected modules with
  `DRAFT=1 NO_SCREENCAST=1` (silent placeholder audio, burned-in captions, no
  paid APIs) and deploys a preview to GitHub Pages at `pr-<N>/`.
- **`/render-paid`** — a PR comment from a maintainer triggers `pr-render-paid.yml`,
  a real paid render. Don't run paid builds yourself.
- **The artifact cache is restored from the `gh-pages` branch** before every
  build (`npm run ci:restore`) and saved back after a paid build — so an
  unchanged segment is a free cache hit. Never hand-edit files under `.cache/`
  or the generated `assets/` dirs; let the content-hash cache manage them.
- A change to a segment's `narration` / prompt **must** change the generator's
  cache key (it hashes the text) — that's expected and correct.
- See `docs/CI.md` for the full workflow map.

## Presenter — one face for the whole course

Every module uses the **same** recurring presenter, **Yuli**. Never generate,
cast, or restyle a new presenter per video — a new face breaks series
continuity.

- `defaults.avatar.image_url` is always `assets/avatars/yuli.jpg` — the
  committed in-repo headshot. `build.ts` inlines any repo-relative `image_url`
  as a base64 data URI for the lipsync API, so never use an external
  image-host URL (`mp.astria.ai`, `tmpfiles.org`, …) here.
- Intro footage is Yuli's, reused: point `intro.background_video` /
  `background_image` straight at `assets/avatars/video-style-transfer/00-intro-seedance.mp4`
  + `intro-fullbody-wide.jpg` (reference in place — don't copy, or CI must
  seed the gitignored .mp4 onto gh-pages). Her source images (headshot,
  microphone shots, full-body frames) live in `assets/avatars/video-style-transfer/`.
- Only `subtitle_html` changes per module — the presenter and show-open stay identical.

## Project Structure

- `index.html` — main composition (root timeline)
- `compositions/` — sub-compositions referenced via `data-composition-src`
- `meta.json` — project metadata (id, name)
- `transcript.json` — whisper word-level transcript (if generated)

## Linting — ALWAYS RUN AFTER CHANGES

After creating or editing any `.html` composition, **always** run the linter before considering the task complete:

```bash
npx hyperframes lint
```

Fix all errors before presenting the result. Warnings are informational and usually safe to ignore.

## Key Rules

1. Every timed element needs `data-start`, `data-duration`, and `data-track-index`
2. Elements with timing **MUST** have `class="clip"` — the framework uses this for visibility control
3. Timelines must be paused and registered on `window.__timelines`:
   ```js
   window.__timelines = window.__timelines || {};
   window.__timelines["composition-id"] = gsap.timeline({ paused: true });
   ```
4. Videos use `muted` with a separate `<audio>` element for the audio track
5. Sub-compositions use `data-composition-src="compositions/file.html"` to reference other HTML files
6. Only deterministic logic — no `Date.now()`, no `Math.random()`, no network fetches
