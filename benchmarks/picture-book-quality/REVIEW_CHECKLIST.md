# M10 Picture-book Quality Review Checklist

Issue: #111

Use this checklist with the fixed fixture in `FIXTURE.json`. Do not change provider/model defaults or run real generation without explicit owner approval.

## Review unit

Review each generated image independently, then compare page 1, page 2 and the explicit page-2 regeneration side by side.

Score each criterion from 1–5:

- **faceIdentity** — same face/identity as the selected character reference
- **clothing** — Mimi yellow scarf, blue overalls and red satchel; Pip green cap, yellow striped scarf and orange satchel remain correct
- **colors** — character palette remains stable
- **proportions** — body/head/limb proportions remain recognizable
- **artMediumStyle** — owner-approved bright, polished cartoon storybook style (crisp outlines, saturated coherent colors, expressive glossy eyes, sunny lighting) stays consistent
- **sceneContinuity** — character scale, lighting and scene logic remain coherent across pages
- **promptAdherence** — requested characters/actions/objects are present and no extra major subject is introduced

Also record:

- **unwantedTextArtifacts** — `NONE`, `UNREQUESTED_TEXT`, `GARBLED_TEXT`, or a short safe code
- **technicalDefects** — safe defect codes only; do not paste provider response bodies
- **accepted** — reviewer decision for use in the product
- **generationLatencyMs**
- **costMinor** — actual attributable image cost in minor currency units when known
- **providerRequestId** — allowed only as opaque request metadata
- **publicEvidenceRef** — stable, non-signed review evidence reference; never a signed BOS URL

## Side-by-side acceptance

The fixture passes the human gate only when:

1. both characters remain recognizable across both pages and explicit regeneration;
2. locked clothing/accessories/colors do not materially drift;
3. the art medium/style remains coherent;
4. no critical unwanted text/extra-character/limb defect is present in an accepted image;
5. accepted/failed counts, latency and cost-per-accepted-image are recorded;
6. reviewer evidence is complete;
7. any provider/model change has a separate quality + latency + cost comparison and owner approval.

## Current status (2026-11-16)

The committed fixture and deterministic tests are safe to run without provider charges. The owner approved the bright cartoon visual direction and Pip's fixed yellow striped scarf (Issue #111 comment 6869876034).

**Reference-image import/lock and private signed playback: PASS, not the visual gate.** Mac Plan B validated two actual Mimi/Pip READY/IMPORTED, selected and locked character references, and signed BOS GET 200 with exact SHA-256 (Issue #111 [final Gate B report](https://github.com/Fredilly/Xiaohai/issues/111#issuecomment-6910281655)). The isolated API was safely stopped; the original database and objects were preserved.

**Generated quality evaluation: NOT_RUN.** The three required `page-1-original`, `page-2-original`, `page-2-regeneration` images, side-by-side human reviewer evidence, image cost/latency and quality scores remain pending. Existing historical image benchmark evidence may be used only as candidate visual-style references; it is not proof this fixed two-page fixture passed. The committed `FIXTURE.json` remains at `PENDING_OWNER_VISUAL_APPROVAL` for generated output and `realGenerationPolicy.authorized=false`.

For a final review artifact, use `REVIEW_TEMPLATE.json` and record a real human `reviewer` and UTC `reviewedAt`, three exact page/revision IDs, frozen Qwen/Bailian provider and model, independent stable non-signed evidence references, actual cost for **every** attempt (including failed calls) and the manual 1–5 scores. The deterministic validator rejects missing or contradictory final evidence; it does **not** automatically decide aesthetic approval or authorize paid generation. No model switch without owner approval.

**Paid-run STOP:** Even the previously discussed maximum **3** Qwen calls / hard **CNY ¥2** limit is not an unconditional execution instruction. Confirm isolated runtime, current provider price, server-side global/user budget headroom including outstanding AT_RISK reservations and a fresh non-paid preflight before the first call. No automatic retry or call beyond the cap. If any condition is unverified, record **NOT_RUN**, never simulate a PASS or spend. A real provider run and all user-visible visual scores require separate authorized execution and human judgment.

**Independent fault injection:** A real BOS 500 failure was intentionally **NOT_RUN** during successful signed playback. Validate controlled non-paid fault injection separately with an isolated fail-closed test double before any destructive/live fault introduction; do not sabotage existing private objects or shared infrastructure.
