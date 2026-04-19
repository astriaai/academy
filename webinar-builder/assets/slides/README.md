# Slides

Source: https://docs.google.com/presentation/d/13xBMQl5EWza8cMOzLVSR76wQzgHZe4OTH-7STvJfcxg/

## Manual export (quickest for POC)

1. Open the deck, File → Download → PNG (current slide) for each slide you need
2. Save as `NN-<segment-id>.png` (e.g. `02-traditional-photoshoot.png`)
3. Recommended: 1920×1080, 16:9

## Automated (post-POC)

`pipeline/slides-export.ts` uses the Google Slides API to pull every slide to PNG.
Requires a service-account JSON at `.credentials/google-slides-sa.json` and `GOOGLE_SLIDES_ID` in `.env`.
