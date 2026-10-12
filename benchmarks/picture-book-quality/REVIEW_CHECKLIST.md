# M10 Picture-book Quality Review Checklist

Issue: #111

Use this checklist with the fixed fixture in `FIXTURE.json`. Do not change provider/model defaults or run real generation without explicit owner approval.

## Review unit

Review each generated image independently, then compare page 1, page 2 and the explicit page-2 regeneration side by side.

Score each criterion from 1–5:

- **faceIdentity** — same face/identity as the selected character reference
- **clothing** — scarf/cap/overalls remain correct
- **colors** — character palette remains stable
- **proportions** — body/head/limb proportions remain recognizable
- **artMediumStyle** — watercolor/storybook medium and rendering style stay consistent
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

## Current status

The committed fixture and deterministic tests are safe to run without provider charges.

Real side-by-side evidence remains **PENDING OWNER APPROVAL**. Existing historical image benchmark evidence may be used only as candidate visual-style references; it is not proof that this fixed two-page fixture has passed.
