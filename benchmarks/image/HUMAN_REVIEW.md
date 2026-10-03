# Human Visual Review

Review of all 36 images in the committed `results/qwen-vs-zimage-20261003.json`. The ignored raw JSON was only the local source input. Per-image ratings and defects are complete in `PER_IMAGE_REVIEW.json`; the group table below summarizes those records. N/A means the criterion does not apply to that prompt.

| Prompt                    | Model          | Character consistency | Prompt adherence | Illustration quality | Observations                                                                     |
| ------------------------- | -------------- | --------------------: | ---------------: | -------------------: | -------------------------------------------------------------------------------- |
| portrait-child-friendly   | qwen-image-3.0 |                   4.5 |              5.0 |                  4.7 | —                                                                                |
| portrait-child-friendly   | z-image-turbo  |                   4.8 |              5.0 |                  4.5 | More consistent recurring character shape.                                       |
| same-character-new-scene  | qwen-image-3.0 |                   4.3 |              5.0 |                  4.7 | —                                                                                |
| same-character-new-scene  | z-image-turbo  |                   4.7 |              5.0 |                  4.4 | More consistent recurring character shape.                                       |
| two-recurring-characters  | qwen-image-3.0 |                   4.3 |              5.0 |                  4.6 | —                                                                                |
| two-recurring-characters  | z-image-turbo  |                   4.6 |              5.0 |                  4.4 | Slightly stronger recurring-character consistency.                               |
| detailed-indoor-scene     | qwen-image-3.0 |                   N/A |              5.0 |                  4.8 | Richer space, lighting, materials, and detail.                                   |
| detailed-indoor-scene     | z-image-turbo  |                   N/A |              5.0 |                  4.5 | Simpler, more cartoon-like treatment.                                            |
| outdoor-action-scene      | qwen-image-3.0 |                   N/A |              4.7 |                  4.7 | —                                                                                |
| outdoor-action-scene      | z-image-turbo  |                   N/A |              3.3 |                  4.1 | All 3/3 images added an unrequested human child (`UNREQUESTED_HUMAN_CHARACTER`). |
| chinese-book-visible-text | qwen-image-3.0 |                   N/A |              5.0 |                  4.7 | Run 3 had an extra bird (`EXTRA_BIRD_CHARACTER`); text basically readable.       |
| chinese-book-visible-text | z-image-turbo  |                   N/A |              4.7 |                  4.4 | Runs 1/2/3 had extra birds (`EXTRA_BIRD_CHARACTER`); text basically readable.    |

## Final per-image summary

`reviewStatus` is `complete`; the evidence contains 18 Qwen and 18 Z-Image runs, with complete `manualReview` fields and per-image `obviousTechnicalDefects`.

| Model          | Recurring-character consistency | Prompt adherence | Illustration quality |
| -------------- | ------------------------------: | ---------------: | -------------------: |
| qwen-image-3.0 |                          4.38/5 |           4.89/5 |               4.70/5 |
| z-image-turbo  |                          4.69/5 |           4.50/5 |               4.40/5 |

Defects recorded: Qwen has `EXTRA_BIRD_CHARACTER` on outdoor-action run 2 and chinese-book-visible-text run 3. Z-Image has `UNREQUESTED_HUMAN_CHARACTER` on all three outdoor-action runs and `EXTRA_BIRD_CHARACTER` on all three chinese-book-visible-text runs.

## Overall observations

- Z-Image Turbo is more cartoon-like, visually simpler, and more aligned with a low-age picture-book/IP-animation direction.
- Qwen Image 3.0 is more semi-realistic, with richer lighting, materials, spatial depth, and detailed storybook illustration treatment.
- Z-Image has a slight recurring-character consistency advantage.
- Qwen is more stable on complex scenes and prompt adherence overall.
- Both models produced basically readable Chinese visible text; extra-bird defects did not make the text itself unreadable.
- “More realistic” and “more cartoon-like” are style differences, not automatic quality rankings.

## Conclusion

Z-Image Turbo is the faster candidate, while Qwen Image 3.0 remains stronger on prompt adherence and detailed illustration quality. The outdoor-action prompt showed a clear Z-Image adherence regression in all 3 runs, so this benchmark is not sufficient evidence to switch the production default solely on speed. Production routing remains unchanged. The final product default should be chosen together with Xiaohai's desired visual direction: more cartoon/IP-like or more detailed/semi-realistic storybook.
