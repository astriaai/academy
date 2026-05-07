# webinar-builder

A scriptable, rebuildable video webinar for the Astria fashion-lookbook course.

- **Script** (`script/webinar.yaml` + `script/segments/*.yaml`) is the source of truth.
- **Pipeline** (`pipeline/*.ts`) regenerates only what changed: narration audio, avatar clips, and the HTML composition.
- **Render** (`hyperframes render`) produces the MP4.

Edit a narration line → re-run `npm run build:segment -- <id>` → only that segment re-renders.

## Tiers

| Tier  | Needs             | What you get                                                                 |
| ----- | ----------------- | ---------------------------------------------------------------------------- |
| **A** | nothing extra     | macOS `say` narration over a design-matched slide. Fast, free, validates layout. |
| **B** | `HEYGEN_API_KEY`  | HeyGen Avatar IV lip-synced talking head + native HeyGen voice.              |

The same `npm run build` command drives both — if `HEYGEN_API_KEY` is set in `.env`, Tier B kicks in; otherwise Tier A.

## Quickstart

```bash
npm install
npm run build:segment -- 03-traditional-photoshoot   # renders out/03-traditional-photoshoot.mp4
```

## Switching to Tier B (real avatar)

```bash
cp .env.example .env
# edit .env — paste your HeyGen key into HEYGEN_API_KEY=
npm run build:segment -- 03-traditional-photoshoot
```

The build script will:
1. Call HeyGen Avatar IV with the segment's narration text
2. Poll until the job completes
3. Download the MP4 to `assets/avatars/<id>.mp4` (cached by hash of text+avatar+voice)
4. Extract the audio track to `assets/audio/<id>.mp3`
5. Swap the `<!-- tier-a:start ... end -->` block in `index.html` for a `<video>` element
6. Re-render the composition

Change the narration text → the hash changes → HeyGen is called again for that segment only.

## Iteration loop

Fastest feedback:

```bash
npm run preview   # opens HyperFrames studio with hot-reload
```

Full render:

```bash
npm run build:segment -- 03-traditional-photoshoot
```

Multiple segments (once the script has them):

```bash
npm run build:all
```

## Editing a segment

1. Open `script/segments/<id>.yaml`
2. Tweak the `narration:` block
3. `npm run build:segment -- <id>`

The slide content (title/bullets/footer) currently lives in `index.html`. For the POC this is inline for simplicity; when we add segments 3+ we'll split each segment into its own sub-composition under `compositions/`.

## Directory map

```
webinar-builder/
├── index.html                   # Root composition (single-segment POC)
├── hyperframes.json             # HyperFrames project config
├── DESIGN.md                    # Visual identity (colors, type, motion)
├── script/
│   ├── webinar.yaml             # Global defaults + segment order
│   └── segments/
│       └── 03-traditional-photoshoot.yaml
├── assets/
│   ├── audio/                   # TTS / HeyGen audio, auto-generated
│   ├── avatars/                 # HeyGen MP4s, hash-cached
│   └── slides/                  # (future) PNG slide exports
├── pipeline/
│   ├── build.ts                 # orchestrator (npm run build:*)
│   └── generate-avatar.ts       # HeyGen client (npm run avatar)
└── out/
    └── *.mp4                    # rendered outputs
```

## Roadmap

- [x] Tier-A render path (macOS say + slide)
- [x] Tier-B HeyGen Avatar IV client with hash cache
- [ ] `website-to-hyperframes` integration for Astria UI demo segments
- [ ] Multi-segment composition (sub-compositions per segment)
- [ ] Burned-in captions from `transcript_en.srt`
- [ ] Voice clone of Alon (ElevenLabs)
