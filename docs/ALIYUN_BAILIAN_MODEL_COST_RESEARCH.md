# Alibaba Cloud Model Studio (Bailian) — Xiaohai AI Model & Cost Research

> Date: 2026-09-28  
> Scope: research only; no production integration or paid workload in this change.  
> Region/pricing baseline: China (Beijing / 华北2), public list price unless stated otherwise.

## 1. Why this matters to Xiaohai

Xiaohai V1 defines three AI workflows: Story (M9), Picture Book (M10), and Animation (M11), on top of the shared AI platform (M8). The repository architecture requires provider adapters, async jobs where appropriate, moderation, retry/timeout, and usage/cost logging.

This research focuses on the first two workflows and TTS:

```text
idea
  -> story / structured storyboard
  -> character reference
  -> page illustrations
  -> optional narration
```

The main finding is that **illustration generation dominates per-book cost**. Text generation is comparatively negligible for a short children's book.

## 2. Shortlist

| Use | Candidate | Beijing list price | Rate limit | Key task limits / capabilities | Current view |
| --- | --- | ---: | --- | --- | --- |
| Story + storyboard | `qwen3.7-flash` | input ¥0.20/M tokens; output ¥0.80/M tokens for input <=32K | 30,000 RPM; 5M TPM | 1M context; max output 131,072; structured output supported | Primary cost candidate |
| Story + storyboard | `qwen-flash` | input ¥0.15/M; output ¥1.50/M for input <=128K | 60 RPM; 1M TPM | Low input price but higher output price than qwen3.7-flash | Secondary comparison |
| Illustration | `qwen-image-3.0` | image input ¥0.02/image; output ¥0.18/image (1K/2K) | 20 RPM | text-to-image + edit; up to 6 outputs; up to 2048×2048 | Primary cost candidate |
| Illustration | `wan2.7-image` | ¥0.20/output image | 300 RPM | text/image input; up to 9 input images; prompt <=5,000 chars; input image <=20MB; 1K/2K output | Primary consistency candidate |
| High-quality illustration | `wan2.7-image-pro` | ¥0.50/output image | 300 RPM | stronger subject consistency; multi-image reference; up to 4K for text-to-image | Use selectively, not default |
| Narration | `cosyvoice-v3.5-flash` | ¥0.80/10K chars | 180 RPM | multilingual TTS; free-style instruction control | Cost baseline for narration |

### Why not default to a Max/Pro model?

For a children's story and an 8–12 page storyboard, the text workload is small. A high-end text model may improve difficult reasoning tasks, but ordinary story generation does not justify using it by default. For images, Pro models can be reserved for a cover, a failed page, or a quality-sensitive final render.

## 3. Cost model

These estimates deliberately ignore newcomer free quota. Free quota is useful for development, but production decisions should work after it expires.

### 3.1 Text

Assumption for one book:

- 3,000 input tokens across prompts/context;
- 5,000 output tokens across story + structured storyboard;
- input remains in the <=32K qwen3.7-flash price tier.

```text
qwen3.7-flash
input  = 3,000 / 1,000,000 × ¥0.20 = ¥0.0006
output = 5,000 / 1,000,000 × ¥0.80 = ¥0.0040
total  ≈ ¥0.0046/book
```

Text is therefore not the main cost driver.

### 3.2 Illustration

For character consistency, the estimate assumes one standalone character reference image, then one reference image supplied for each page.

#### 8-page book

```text
qwen-image-3.0:
9 output images × ¥0.18            = ¥1.62
8 reference-image inputs × ¥0.02   = ¥0.16
illustration subtotal               = ¥1.78
```

For `wan2.7-image`, the public model pricing page lists ¥0.20 per generated image and does not separately list a reference-image input charge:

```text
9 output images × ¥0.20 = ¥1.80
```

#### 12-page book

```text
qwen-image-3.0:
13 output images × ¥0.18           = ¥2.34
12 reference-image inputs × ¥0.02  = ¥0.24
illustration subtotal               = ¥2.58

wan2.7-image:
13 output images × ¥0.20           = ¥2.60
```

### 3.3 Narration

Using `cosyvoice-v3.5-flash` as the easy-to-budget TTS baseline:

- ~1,000 Chinese characters: ~¥0.08;
- ~1,500 Chinese characters: ~¥0.12.

Actual story length should be measured and billed from recorded provider usage.

## 4. Estimated cost per complete picture book

| Scenario | Text | Illustration | TTS | Base total |
| --- | ---: | ---: | ---: | ---: |
| 8 pages — qwen-image-3.0 | ~¥0.005 | ~¥1.78 | ~¥0.08 | **~¥1.87** |
| 8 pages — wan2.7-image | ~¥0.005 | ~¥1.80 | ~¥0.08 | **~¥1.89** |
| 12 pages — qwen-image-3.0 | ~¥0.005 | ~¥2.58 | ~¥0.12 | **~¥2.71** |
| 12 pages — wan2.7-image | ~¥0.005 | ~¥2.60 | ~¥0.12 | **~¥2.73** |

These are **successful-first-pass** estimates, not a product budget.

If illustration spend gets a simple 20% retry/regeneration reserve:

- 8-page qwen-image-3.0 book: ~¥2.22;
- 12-page qwen-image-3.0 book: ~¥3.22.

The production system must cap regeneration or meter it via quota/credits. Unlimited user-triggered regeneration can dominate cost.

## 5. Rate-limit implications

### qwen3.7-flash

30,000 RPM / 5M TPM is far above early Xiaohai story demand. For short children's stories, TPM will likely become relevant before RPM only at substantial scale.

### qwen-image-3.0

20 RPM is materially lower than the text-model limit. Full-book generation should therefore be treated as an asynchronous job, not a synchronous mini-program request. M8's queue/worker architecture is appropriate.

At the published ceiling, 20 image requests/minute is only a theoretical upper bound; actual throughput also depends on generation latency, retries, provider errors, and Xiaohai's own concurrency controls.

### wan2.7-image

The model page lists 300 RPM in Beijing. It is attractive for higher-throughput picture-book generation, but effective production throughput must still be verified with the exact API path and concurrency behavior used by Xiaohai.

### cosyvoice-v3.5-flash

180 RPM is unlikely to constrain an early single-narration-per-book workflow. Audio should still be generated asynchronously and stored in object storage/CDN rather than synthesized on every playback.

## 6. Task limits that affect implementation

### qwen3.7-flash

- input modalities: text/image/video;
- text output;
- structured output supported;
- context: 1,000,000 tokens;
- max output: 131,072 tokens;
- supports function calling and context caching.

For M9/M10, use structured output / schema validation for storyboard data rather than parsing free-form prose.

### qwen-image-3.0

- supports text-to-image and image editing;
- up to 6 outputs;
- up to 2048×2048;
- supported output size range is 512×512 to 2048×2048;
- image input is billed separately.

### wan2.7-image

API constraints relevant to M10:

- prompt <= 5,000 characters;
- 0–9 input images;
- input image formats: JPEG/JPG/PNG (no transparent channel), BMP, WEBP;
- each input image <=20MB;
- input width/height: 240–8,000 px;
- input aspect ratio: 1:8 to 8:1;
- output supports 1K/2K, up to 2048×2048.

`wan2.7-image-pro` is the higher-quality option and explicitly targets stronger subject consistency / multi-image reference; text-to-image can reach 4K. Its ¥0.50/image list price makes it better suited to selective upgrades than default page generation.

## 7. Playground observations from 2026-09-28

### Story

A children's story prompt produced a coherent `小海买盐` story with an appropriate arc and tone. However, a "within 600 Chinese characters" requirement was not followed strictly.

**Implementation implication:** enforce length server-side and allow controlled rewrite/shorten retries.

### Structured storyboard

The story was converted into 8 JSON pages with:

- `page`;
- `narration`;
- `characters`;
- `scene`;
- `imagePrompt`.

The character description stayed consistent across prompts.

**Implementation implication:** this is a good contract shape for M10, but validate it with Zod/JSON Schema rather than trusting raw model output.

### Illustration consistency

A reference image of Xiaohai was reused across different scenes. Face, hair, approximate age, yellow shirt, blue shorts, and general picture-book style remained recognizably consistent.

A limitation was also visible: when a full scene image was used as the character reference, background elements (window/lamp/furniture) leaked into the requested store scene.

**Implementation implication:** create a dedicated character sheet/reference with a simple background and reuse that reference across pages. Do not chain page N as the sole reference for page N+1.

### TTS

The tested Qwen Audio TTS experience produced natural Mandarin narration, reasonable pauses, and some emotional variation between narration and dialogue. Multi-character voice separation was limited.

**Implementation implication:** V1 can start with one narrator voice; multi-character casting can be a later quality feature.

## 8. Recommended V1 experiment

Do **not** choose an image provider by list price alone.

Run the same mini benchmark on `qwen-image-3.0` and `wan2.7-image`:

1. generate one neutral character sheet;
2. generate the same three key pages (home / store / ending);
3. record first-pass success;
4. record character consistency;
5. record scene contamination;
6. record average regeneration count;
7. record latency;
8. calculate **effective cost per accepted page**.

The model with the lowest accepted-page cost and acceptable consistency should be the default. Keep a higher-quality model as a controlled fallback.

## 9. Proposed V1 model policy

- **Story + storyboard:** `qwen3.7-flash` as the initial cost baseline.
- **Picture-book pages:** A/B test `qwen-image-3.0` vs `wan2.7-image`; no final provider lock yet.
- **High-quality fallback / cover:** consider Pro only when needed.
- **Narration:** use `cosyvoice-v3.5-flash` as the cost baseline; compare quality against the Qwen Audio TTS already tested.
- **All providers:** server-side adapter only; never expose provider API keys to the Mini Program.
- **Usage:** persist provider/model, input/output units, estimated/actual cost, latency, retries, failure code, and asset IDs per AI job.

## 10. Free quota

The current test account has newcomer/model-specific free quota and "stop when free quota is exhausted" was enabled before Playground testing.

Free quota is intentionally excluded from the production estimates above because:

1. it expires;
2. quotas vary by model/account/activity;
3. it should reduce development cost, not hide unit economics.

Before any paid API PoC, verify the account's current quota and keep the stop-on-exhaustion protection enabled.

## 11. Decisions still needed before M8/M10 implementation

- target maximum cost per generated book;
- 8 vs 12 default page count;
- whether narration is included by default;
- allowed user regeneration count;
- acceptable image generation latency;
- default output resolution;
- whether cover uses the same model or a higher-quality fallback;
- children's content moderation policy;
- retention/deletion policy for prompts, generated media, and provider logs.

## 12. Official sources

Checked 2026-09-28:

- Qwen3.7 Flash model/pricing/limits: https://help.aliyun.com/zh/model-studio/qwen3-7-flash
- Qwen Flash model/pricing/limits: https://help.aliyun.com/zh/model-studio/qwen-flash
- Qwen Image 3.0 model/pricing/limits: https://help.aliyun.com/zh/model-studio/qwen-image-3-0
- Image model comparison / output limits: https://help.aliyun.com/zh/model-studio/image-model
- Wan 2.7 Image model/pricing/limits: https://help.aliyun.com/zh/model-studio/wan2-7-image
- Wan 2.7 Image API constraints: https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference
- Wan 2.7 Image Pro: https://help.aliyun.com/zh/model-studio/wan2-7-image-pro
- CosyVoice 3.5 Flash: https://help.aliyun.com/zh/model-studio/cosyvoice-v3-5-flash
- Model pricing index: https://help.aliyun.com/zh/model-studio/model-pricing

## 13. Scope of this change

Documentation only.

- No production code changed.
- No API key created or committed.
- No provider integration added.
- No database/schema changes.
- No paid workload intentionally started.
