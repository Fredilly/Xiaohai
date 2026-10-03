# Image Benchmark Manifest

Models: qwen-image-3.0, z-image-turbo
Runs per model: 3
Prompts: 6
Total provider calls: 36

- qwen-image-3.0: 18/18 success; p50 9136 ms; p95 10674 ms; failures 0
- z-image-turbo: 18/18 success; p50 7595 ms; p95 9694 ms; failures 0

Formal benchmark artifact: `raw/raw-20261003T022843Z.json` (18 runs per model, 36 total). Earlier smoke-test and failed-test artifacts are excluded.

These latency results are descriptive only; they do not select a default model. Quality ratings and any visual-quality conclusion remain pending human review in `GALLERY.html` / `SCORECARD.md`. TTFT is not available from the current non-streaming image provider.

## Manual reviewer workflow

1. Open `benchmarks/image/GALLERY.html` in a browser.
2. Review each existing image and fill the three 1–5 fields plus notes. Ratings are saved automatically in that browser's local storage and restored after refresh.
3. Use **Export ratings JSON** to save the review file. Use **Import ratings JSON** to restore it elsewhere, or **Clear ratings** to remove the local copy.

The exported JSON contains only model, prompt ID, run number, the three ratings, and notes. It contains no credentials, provider responses, secrets, or image bytes.
