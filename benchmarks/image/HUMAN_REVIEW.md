# Human Visual Review

Review of the 36 images in `raw/raw-20261003T022843Z.json`, grouped by prompt. Scores are manual 1–5 ratings; N/A means the criterion does not apply to that prompt.

| Prompt                    | Model          | Character consistency | Prompt adherence | Illustration quality | Observations                                                           |
| ------------------------- | -------------- | --------------------: | ---------------: | -------------------: | ---------------------------------------------------------------------- |
| portrait-child-friendly   | qwen-image-3.0 |                   4.5 |              5.0 |                  4.7 | —                                                                      |
| portrait-child-friendly   | z-image-turbo  |                   4.8 |              5.0 |                  4.5 | More consistent recurring character shape.                             |
| same-character-new-scene  | qwen-image-3.0 |                   4.3 |              5.0 |                  4.7 | —                                                                      |
| same-character-new-scene  | z-image-turbo  |                   4.7 |              5.0 |                  4.4 | More consistent recurring character shape.                             |
| two-recurring-characters  | qwen-image-3.0 |                   4.3 |              5.0 |                  4.6 | —                                                                      |
| two-recurring-characters  | z-image-turbo  |                   4.6 |              5.0 |                  4.4 | Slightly stronger recurring-character consistency.                     |
| detailed-indoor-scene     | qwen-image-3.0 |                   N/A |              5.0 |                  4.8 | Richer space, lighting, materials, and detail.                         |
| detailed-indoor-scene     | z-image-turbo  |                   N/A |              5.0 |                  4.5 | Simpler, more cartoon-like treatment.                                  |
| outdoor-action-scene      | qwen-image-3.0 |                   N/A |              4.7 |                  4.7 | —                                                                      |
| outdoor-action-scene      | z-image-turbo  |                   N/A |              3.3 |                  4.1 | One image clearly added an unrequested human child; prompt regression. |
| chinese-book-visible-text | qwen-image-3.0 |                   N/A |              5.0 |                  4.7 | Chinese visible text basically readable.                               |
| chinese-book-visible-text | z-image-turbo  |                   N/A |              4.7 |                  4.4 | Chinese visible text basically readable.                               |

## Overall observations

- Z-Image Turbo is more cartoon-like, visually simpler, and more aligned with a low-age picture-book/IP-animation direction.
- Qwen Image 3.0 is more semi-realistic, with richer lighting, materials, spatial depth, and detailed storybook illustration treatment.
- Z-Image has a slight recurring-character consistency advantage.
- Qwen is more stable on complex scenes and prompt adherence overall.
- Both models produced basically readable Chinese visible text.
- “More realistic” and “more cartoon-like” are style differences, not automatic quality rankings.

## Conclusion

Z-Image Turbo is the faster candidate, while Qwen Image 3.0 remains stronger on prompt adherence and detailed illustration quality. The outdoor-action prompt showed a clear Z-Image adherence regression, so this benchmark is not sufficient evidence to switch the production default solely on speed. Production routing remains unchanged. The final product default should be chosen together with Xiaohai’s desired visual direction: more cartoon/IP-like or more detailed/semi-realistic storybook.
