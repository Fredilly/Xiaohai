# Qwen Flash Story Benchmark

## Scope

- Model: `qwen-flash`
- Page count: 10
- Input: a shy little fox helps a lost bird return home; target age 5–7; theme courage and helping others; warm fairytale style.
- 5 runs per strategy; text-only; no database writes, formal Story versions, images, picture books, or animation.
- TTFT: unavailable (`null`) because the provider adapter uses non-streaming responses.
- Regeneration: 0 for both strategies.

## Results

| Strategy      | Success | p50 total latency |   Slowest | Avg input tokens/run | Avg output tokens/run | Avg total tokens/run | Provider calls | Timeout | Structural problems |
| ------------- | ------: | ----------------: | --------: | -------------------: | --------------------: | -------------------: | -------------: | ------: | ------------------: |
| ONE_SHOT      |     5/5 |          8,038 ms |  9,607 ms |                153.0 |               1,151.6 |              1,304.6 |              5 |       0 |                   0 |
| OUTLINE_FIRST |     5/5 |         12,450 ms | 13,122 ms |                572.2 |               1,576.8 |              2,149.0 |             10 |       0 |                   0 |

All 10 effective runs produced 10 pages and passed structured validation. Token averages are per completed Story run: all provider calls within one run are summed first, then successful runs are averaged. No failed runs contributed tokens.

## Recommendation

Use ONE_SHOT as the current baseline. Both strategies succeeded in 5/5 runs and had zero structural problems, but ONE_SHOT had lower p50 latency (8,038 ms vs 12,450 ms), fewer provider calls (5 vs 10), and lower measured per-run token usage (1,304.6 vs 2,149.0 total tokens). This recommendation is based on these measurements only; no subjective story-quality ranking was performed.

## Benchmark configuration note

The first OUTLINE_FIRST attempt used `responseFormat: json_object` for its plain-text outline call, conflicting with the intended two-stage comparison. That produced invalid timeout data and was excluded. The call-level response format selection was fixed before the valid OUTLINE_FIRST rerun.

## Sources

- Effective ONE_SHOT runs: `raw/raw-20260930T154529Z.json` (only its five ONE_SHOT successes).
- Effective OUTLINE_FIRST runs: `raw/raw-20261001T024027Z.json` (five successful runs).
- Consolidated safe artifact: `results/qwen-flash-10-page.json`.
