# Demo intent DSL

Human-authored YAML that describes *what* a demo segment shows, *what* the narrator says, and *how* the cursor moves through the UI — without mentioning Playwright selectors or timing primitives.

## Workflow

```
scripts/intent/<id>.yaml      # author once (intent)
       │
       │  Claude Code:  /compile-intent <id>
       ▼
scripts/record/<id>.ts        # generated Playwright script (review before commit)
       │
       │  npm run build:segment -- <id> --rerecord
       ▼
assets/captures/<id>.mp4      # real browser recording
```

Two things you edit as a human:
1. `scripts/intent/<id>.yaml` — the story (plain English)
2. `storageState.json` — your authenticated Astria session (generated once; see *Auth* below)

Everything else is generated.

## Schema

```yaml
id: 04-lookbook-references
title: "Working with references in the Lookbook"

# Optional — lets reviewers cross-check against the original webinar.
source:
  webinar_file: "../astria-webinar.mp4"
  timestamp: "01:09:30-01:10:30"
  transcript_range: [540, 560]

# The concrete URL the browser should end up on.
url: https://www.astria.ai/prompts
requires_auth: true         # use storageState.json

# Optional browser settings. All fields have sensible defaults.
viewport: 1600x900
device_scale_factor: 2

# Total runtime. The compiler distributes time across beats proportionally
# if individual beats don't specify their own duration.
duration_s: 30

# Ordered list of beats. Each beat is a block of one coherent action + the
# narration that accompanies it. The compiler converts each to a sequence of
# Playwright calls: waitForSelector → glide cursor → action → settle.
beats:
  - id: land
    at: "0-3s"
    say: "Let me open the Lookbook I've been working on."
    show: "Lookbook mode with 9 reference slots filled."
    action: settle

  - id: survey-slots
    at: "3-8s"
    say: "Each slot holds a reference — pose, face, jacket, shirt, footwear, background."
    show: "cursor glides over the grid of reference slots."
    action:
      type: cursor-tour
      targets:
        - "[data-slot='pose']"
        - "[data-slot='face']"
        - "[data-slot='jacket']"
        - "[data-slot='jeans']"

  - id: open-context
    at: "8-14s"
    say: "Right-click any reference to crop, remove background, or edit in place with Nano Banana."
    show: "context menu opens on the jacket reference."
    action:
      type: right-click
      target: "[data-slot='jacket'] img"
      hold_ms: 2500

  - id: remove-bg
    at: "14-22s"
    say: "Here I'll remove the background from this jacket."
    show: "click 'Remove Background'; preview updates in place."
    action:
      type: click
      target: "text=Remove Background"
      wait_after_ms: 4000

  - id: settle
    at: "22-30s"
    say: "The reference updates in place — no need to re-upload."
    show: "hover the updated thumbnail, settle."
    action:
      type: hover
      target: "[data-slot='jacket']"
      hold_ms: 5000
```

### Supported `action` types

| type            | fields                                         | notes                                                           |
| --------------- | ---------------------------------------------- | --------------------------------------------------------------- |
| `settle`        | none                                           | wait silently for the beat's window                             |
| `goto`          | `url`                                          | page navigation                                                 |
| `scroll-to`    | `y`, `duration_ms`                             | smooth-scroll to absolute Y                                     |
| `hover`         | `target`, `hold_ms?`                           | glide cursor to element, pause                                  |
| `click`         | `target`, `wait_after_ms?`                     | real click                                                      |
| `right-click`   | `target`, `hold_ms?`                           | opens a context menu                                            |
| `type`          | `target`, `text`, `delay_ms?`                  | types into an input                                             |
| `upload`        | `target`, `files: ["path/in/assets"]`          | fills a file `<input>`                                           |
| `cursor-tour`   | `targets: [selector…]`, `per_ms?`              | glides the cursor across multiple elements                      |
| `wait-for`     | `target`, `timeout_ms?`                        | waits for a selector to appear (e.g. after a generation)        |

Selector syntax follows Playwright (`text=…`, `[data-testid=…]`, `role=…`). Always prefer a semantic handle over a structural one.

## Auth — persisted storage state

The real Astria product requires login. Do this **once**:

```bash
npx tsx scripts/auth/login.ts
```

…which opens a headed Chromium, lets you log in manually (Google SSO), then saves the resulting cookies + localStorage to `storageState.json` (gitignored). Every recording after that replays with that state.

## Compiling intent → Playwright

Two options today:

1. **Claude Code** — paste the intent YAML into a Claude Code chat and ask:
   > "Compile `scripts/intent/04-lookbook-references.yaml` into `scripts/record/04-lookbook-references.ts`
   > matching the pattern of the existing scripts."

2. **`npm run compile-intent <id>`** — optional; requires `ANTHROPIC_API_KEY`. Calls Claude to
   generate the .ts file and writes it to `scripts/record/<id>.ts`. Review before committing.

Whichever path you use, the generated `.ts` is committed to git alongside the intent YAML.
Re-compile any time the UI changes enough that selectors break.

## Mapping webinar moments

When you want a segment to reflect a specific part of the original recording, fill in `source`:

```yaml
source:
  webinar_file: "../astria-webinar.mp4"
  timestamp: "01:09:30-01:10:30"
```

Two helpers are available for grounding your intent in what the presenter actually does:

### Visual keyframe sampling

```bash
npm run inspect-webinar -- 01:09:30 01:10:30
```

Extracts keyframes every 2 seconds and prints their paths. Fast, no API cost; useful for
eyeballing what the UI looks like.

### Gemini video analysis (recommended)

```bash
npm run gemini-inspect -- 01:09:30 01:10:30 04-lookbook-references
```

Chops the clip, uploads it inline to Gemini 2.5 Flash (via `VERTEX_API_KEY`), and asks a
structured prompt for:

- URLs visible in the browser chrome
- the dominant UI state
- **ordered list of user interactions** (hover / click / right-click / type / scroll),
  each with a `target_text`, `target_description`, and `outcome`
- notable UI affordances on screen
- open questions

Output is saved to `.cache/gemini/<segment-id>.json`. It's designed to drop almost verbatim
into the `beats:` section of your intent YAML. Reference it from `source.gemini_report`.

Use this first; only fall back to manual keyframe inspection when Gemini is unsure.
