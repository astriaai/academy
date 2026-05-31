# Future Astria Video Guide

Use this guide when creating or revising short-form Astria tutorial videos in `/Users/burg/git/astria-course/webinar-builder`. It is based on the current short projects: `3d-packshots`, `edit-image`, `face-inpainting`, `video-style-transfer`, and `artboard-2`.

Do not use the long-form `webinar` / "Astria course" project as the structure for new short videos. It is a different format.

## Contents

- Current Pattern
- Canonical Structure
- Project Manifest Pattern
- Writing Style
- Validation Checklist

## Current Pattern

The best short modules are not slide lectures. They are fast feature films for a product workflow:

- Start with Yuli in a contextual real-life scene connected to the feature.
- Show the finished outputs early, with input-vs-output comparison where possible.
- Move quickly into a planned UI workflow, not an improvised screen recording.
- Recap by showing the actual result and naming the value the user just gained.
- End with an FAQ that answers constraints and use cases while examples stay visible.

Observed full-draft lengths:

- `video-style-transfer`: about 1:58, compact 5-segment pattern.
- `edit-image`: about 2:16, two-workflow cleanup pattern.
- `face-inpainting`: about 2:34, real UI plus final-vs-original comparison.
- `3d-packshots`: about 2:58, output promise plus business-value recap.
- `artboard-2`: about 6:42, longer multi-step workflow/review loop.

Aim for 2-3 minutes for one feature. Allow 5-7 minutes only when the viewer must watch several complete create/review/refine loops.

## Canonical Structure

### 1. Contextual Yuli intro

Use `visual: tv-intro`. Keep it short, cinematic, and feature-specific.

Purpose:

- Establish Yuli as the recurring presenter.
- Make the feature feel real-world, not abstract.
- Set tone and energy before the tutorial begins.

Rules:

- Use Yuli. Do not cast a new presenter or use `unique-headshot`.
- Put Yuli in a context tied to the content: walking among 3D rotating products, standing in an editing suite, reviewing artboards on a table, comparing beauty close-ups, etc.
- Use `narration: ""` for the intro unless there is a strong reason to speak over it.
- Add a whoosh/ding cue and either a project-specific intro cue or the project music bed.
- Save contextual intro assets under `assets/avatars/<project>/`.

YAML shape:

```yaml
id: 00-intro
title: "Astria — Feature Name (TV intro)"
order: 0
visual: tv-intro
duration: 10.0
narration: ""

intro:
  background_video: "assets/avatars/<project>/00-intro-seedance.mp4"
  background_image: "assets/avatars/<project>/intro-fallback.jpg"
  title_html: "ASTRIA"
  subtitle_html: "Feature Name"

sfx:
  - { src: "assets/sfx/whoosh-soft.mp3", start: 0.6, volume: 0.6 }
  - { src: "assets/sfx/ding-soft.mp3", start: 2.0, volume: 0.4 }
```

Music options:

- Reuse `assets/music/luxe-pad.mp3` for quiet editorial modules.
- Use `assets/music/acid-jazz-groove.mp3` with `mix_at_stitch: true` for punchier modules like 3D Packshots and Face Inpainting.
- Generate a new track with `pipeline/generate-music-wavespeed.ts` when the video needs a distinct intro identity. Add a manifest under `script/music-videos/<project>.yaml`, then run:

```bash
npx tsx pipeline/generate-music-wavespeed.ts --manifest script/music-videos/<project>.yaml
```

### 2. Fast output proof

Use `visual: video-showcase` unless the output needs a custom review layout.

Purpose:

- Hook the viewer before teaching.
- Make clear what they will learn to create.
- Show the unique value visually, not only in narration.

Rules:

- Prefer input-vs-output, before-vs-after, or plan-vs-result.
- Label each pane with short uppercase labels: `ONE REFERENCE STILL`, `FULL 360 + STILLS`, `RAW GENERATION`, `INPAINTED FINAL`.
- Use moving clips where possible. If a still is necessary, pair it with a video or animate the surrounding composition.
- Stress the unique part with zoom/crop choices, captions, SFX, and concise narration.
- Avoid static image montages with monotonic TTS.

Good examples:

- `3d-packshots/01-showcase.yaml`: one reference still becomes 360 plus stills.
- `3d-packshots/02-before-after.yaml`: ugly phone reference versus clean packshot.
- `face-inpainting/02-before-after.yaml`: same pose and light, different face quality.
- `video-style-transfer/02b-first-frame-match.yaml`: teaches the first-frame concept with side-by-side proof.

YAML shape:

```yaml
visual: video-showcase

showcase:
  videos:
    - src: "assets/results/<project>/input.jpg"
      label: "INPUT"
    - src: "assets/results/<project>/output.mp4"
      label: "OUTPUT"

caption:
  eyebrow: "BEFORE / AFTER"
  html: |
    One rough input.
    A <span class="accent">finished result</span>.

narration: |
  Say exactly what changed, why it matters, and what the viewer is about
  to learn. Keep this sharp; do not explain the whole UI yet.
```

### 3. Get to work: planned screen recording

Use `visual: screencast-pip`. This is the core teaching section.

Purpose:

- Show the actual Astria workflow.
- Keep the viewer oriented with bullets, markers, cursor movement, and Yuli PiP.
- Remove dead time from async generation.

Plan before recording:

- Write `scripts/intent/<project>/<segment>.yaml` for each complex recording.
- Include URL, auth needs, viewport, duration, narration anchors, selectors, prepared assets, and whether the script clicks Generate.
- Prepare assets before recording: input images, reference videos, completed prompt IDs, output clips, and clean demo workspaces.
- Decide which waiting room gets trimmed. Usually click or hover Generate, then jump to a completed prompt or show the finished result in the next segment.

Clean the environment:

- Use a fixed 1600x900 viewport unless the segment has a reason to differ.
- Dismiss banners after each navigation.
- Clear restored drafts, old reference chips, stale prompt text, hidden file inputs, and toggles.
- Reset feature state before demonstrating it, e.g. turn Inpaint off before recording the act of enabling it.
- Avoid showing private or confusing workspaces unless they are the point of the lesson.

Record like a human:

- Use gliding cursor movement with holds on the important UI.
- Type short prompts at readable speed.
- Use direct `setInputFiles` for hidden upload inputs, but still hover the visible upload affordance so viewers understand the action.
- Zoom the browser or composer when text/details are too small.
- Use markers for the exact UI element named by each bullet.
- Never leave a static browser frame under a long narration block.

Sync the segment:

- Match `slide.bullet_starts` to narration beats.
- Place `ding-soft.mp3` on bullet reveals.
- Place `click-subtle.mp3` on important click/marker moments.
- Use `markers[]` with source-video coordinates, usually 1600x900.
- Keep Yuli PiP throughout `screencast-pip` unless the review layout intentionally removes avatar.

YAML shape:

```yaml
visual: screencast-pip

screencast:
  mode: "video"
  url: "astria.ai/prompts"
  record_script: "scripts/record/<project>/02-workflow.ts"

caption:
  eyebrow: "WORKFLOW"
  html: |
    Short promise with
    <span class="accent">one accent</span>.

slide:
  bullets:
    - "Open the right tool or template."
    - "Upload the prepared input."
    - "Set the important option."
    - "Generate, then review the result."
  bullet_starts: [3.0, 12.0, 22.0, 34.0]

markers:
  - { start: 3.0, duration: 4.0, shape: circle, cx: 260, cy: 145, r: 70, style: luxe-gold }

sfx:
  - { src: "assets/sfx/whoosh-soft.mp3", start: 0.2, volume: 0.5 }
  - { src: "assets/sfx/ding-soft.mp3", start: 3.0, volume: 0.45 }
```

Recorder command:

```bash
HEADED=1 npx tsx pipeline/record-screencast.ts --project <project> <segment-id>
```

Build command:

```bash
DRAFT=1 HF_WORKERS=1 npx tsx pipeline/build.ts --project <project> --segment <segment-id>
```

### 4. Output review and value recap

After the workflow, show what was created. Do not assume the viewer connects the dots.

Use one of:

- `video-showcase` for input/output or before/after.
- `artboard-tile-review` for reviewing still storyboard tiles.
- `artboard-video-review` for comparing a generated video against its artboard plan.
- `presenter-slide` only when paired with moving background examples or when the point is business/decision framing.

Review questions:

- What was the input?
- What is the output?
- What changed?
- What did the user avoid: studio shoot, retouching, reshoot, manual cleanup, prompt ambiguity, waiting?
- What should the viewer inspect before shipping?

Good examples:

- `artboard-2/04-review-studio-artboard.yaml`: reviews tile types like long, medium, close-up, detail, continuity.
- `artboard-2/06-review-first-video.yaml`: compares generated clip to the plan.
- `3d-packshots/03-why-it-matters.yaml`: translates visuals into ecommerce value.

### 5. FAQ, constraints, and useful scenarios

Use `visual: presenter-slide`, but keep it alive with Yuli, background videos, animated bullets, SFX, and concrete examples.

Purpose:

- Help viewers decide when to use the feature.
- Name limitations honestly.
- Give practical constraints, formats, costs, and prompting rules.

FAQ content should usually cover:

- When to use the feature.
- What input quality matters.
- What changes and what stays the same.
- Where the output fits: PDP, lookbook, Reels, training prep, video reference, campaign cut.
- Known limitations or model constraints.
- Best prompt shape or prep step.

Rules:

- Use 2-3 questions for compact modules, 3-4 for 3-minute modules.
- Keep bullets short enough to read.
- Time `bullet_starts` to narration.
- Avoid abstract FAQ copy; tie every answer to a visible example or prior output.

## Project Manifest Pattern

Create `script/projects/<project>.yaml`.

```yaml
meta:
  title: "Feature Name"
  tags:
    - feature-tag
  presenter: "Astria"
  resolution: "1920x1080"
  fps: 30

defaults:
  tts:
    provider: "gemini"
    voice: "Aoede"
    model: "gemini-3.1-flash-tts-preview"

  music:
    src: "assets/music/luxe-pad.mp3"
    volume: 0.12
    # Use only when mixing continuous music during stitch:
    # mix_at_stitch: true

  background_videos:
    - "assets/results/<project>/hero-output.mp4"

  avatar:
    image_url: "assets/avatars/yuli.jpg"
    engine: "infinitetalk"
    resolution: "720p"
    video_prompt: >-
      Subtle natural micro-expressions and very small head movements, calm
      steady pose, looking directly at the camera with quiet confidence, no
      hand gestures, minimal upper-body motion.

segments:
  - 00-intro
  - 01-showcase
  - 02-workflow
  - 03-output-review
  - 04-faqs
```

For two-workflow tutorials, use `02-<first-action>` and `03-<second-action>`, then `04-faqs` as in `edit-image`.

For long multi-step tutorials, repeat workflow/review pairs as in `artboard-2`:

- result promise
- roadmap
- workflow
- review
- workflow
- review
- closing tips

## Writing Style

Use the narration to direct attention, not to read the bullets verbatim.

Prefer:

- "Watch what changes."
- "Same pose, same light, cleaner face."
- "Click Generate; we skip the waiting room."
- "Compare the clip to the plan."
- "This is the first link in the chain."

Avoid:

- Long definitions before showing output.
- Generic marketing claims without proof on screen.
- Static screenshots while TTS explains several unrelated ideas.
- Bullets that are too long to scan.

## Validation Checklist

Run these before calling a video ready:

```bash
npx hyperframes lint
DRAFT=1 HF_WORKERS=1 npx tsx pipeline/build.ts --project <project> --segment <segment-id>
HF_WORKERS=1 npx tsx pipeline/build.ts --project <project> --segment <segment-id>
npx tsx pipeline/build.ts --project <project> --all
npx tsx pipeline/stitch.ts --project <project>
```

Check:

- Intro is contextual and Yuli identity is consistent.
- First 30 seconds show real outputs, not only title/slides.
- Each screencast beat has a visible action.
- Bullet starts, markers, and SFX hit the narration beats.
- Waiting is trimmed or replaced with a completed result.
- FAQ still shows relevant examples or moving background.
- Final stitch has no hard audio jumps and no stale UI state.

For audio:

```bash
ffmpeg -i out/<project>/_full-draft.mp4 -af volumedetect -vn -f null -
```

Mean volume should usually sit around -22 dB to -12 dB. Adjust music/SFX if narration is buried or the mix feels sleepy.
