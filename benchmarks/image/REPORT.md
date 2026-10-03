# Image Benchmark Manifest

Models: qwen-image-3.0, z-image-turbo
Runs per model: 3
Prompts: 6
Total provider calls: 36

- qwen-image-3.0: 18/18 success; p50 9136 ms; p95 10674 ms; failures 0
- z-image-turbo: 18/18 success; p50 7595 ms; p95 9694 ms; failures 0

Formal benchmark artifact: `raw/raw-20261003T022843Z.json` (18 runs per model, 36 total). Earlier smoke-test and failed-test artifacts are excluded.

These latency results are descriptive only; they do not select a default model. Quality ratings and any visual-quality conclusion remain pending human review in `GALLERY.html` / `SCORECARD.md`. TTFT is not available from the current non-streaming image provider.
