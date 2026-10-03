# Image Benchmark Manifest

Models: qwen-image-3.0, z-image-turbo
Runs per model: 3
Prompts: 6
Total provider calls: 36

- qwen-image-3.0: 18/18 success; p50 9136 ms; p95 10674 ms; failures 0
- z-image-turbo: 18/18 success; p50 7595 ms; p95 9694 ms; failures 0

Formal benchmark evidence: `results/qwen-vs-zimage-20261003.json` (18 runs per model, 36 total). This is the committed, redacted immutable evidence artifact. The ignored raw JSON is only the local source input; earlier smoke-test and failed-test artifacts are excluded.

## Final performance result

The formal benchmark completed 36 real images: 18 runs per model, with 18/18 success for both models.

| Model | Success | p50 | p95 | Failures |
|---|---:|---:|---:|---:|
| qwen-image-3.0 | 18/18 | 9136 ms | 10674 ms | 0 |
| z-image-turbo | 18/18 | 7595 ms | 9694 ms | 0 |

Z-Image Turbo is faster in this benchmark. TTFT is unavailable from the non-streaming image provider.

## Human visual review

See [`HUMAN_REVIEW.md`](HUMAN_REVIEW.md) for prompt-group scores and observations. Per-image review evidence is represented by `PER_IMAGE_REVIEW.json` and the results artifact; fields remain pending until each image is manually confirmed. Z-Image is more cartoon-like and has slightly better recurring-character consistency. Qwen is more semi-realistic, with richer detail, lighting, materials, and spatial depth; it is more stable on complex scenes and prompt adherence. Both models produced basically readable Chinese visible text. These are visual-direction differences, not an automatic quality ranking.

The outdoor-action prompt showed a clear Z-Image prompt-adherence regression: one image added an unrequested human child. Therefore, although Z-Image is the faster candidate, this benchmark does not provide enough evidence to switch the production default solely on speed. Keep production routing unchanged. The final product default should be decided together with the desired Xiaohai visual direction: more cartoon/IP-like versus more detailed/semi-realistic storybook.

## Manual reviewer workflow

1. Open `benchmarks/image/GALLERY.html` in a browser.
2. Review each existing image and fill the three 1–5 fields plus notes. Ratings are saved automatically in that browser's local storage and restored after refresh.
3. Use **Export ratings JSON** to save the review file. Use **Import ratings JSON** to restore it elsewhere, or **Clear ratings** to remove the local copy.

The exported JSON contains only model, prompt ID, run number, the three ratings, and notes. It contains no credentials, provider responses, secrets, or image bytes.
