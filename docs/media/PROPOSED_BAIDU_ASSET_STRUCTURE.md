# Proposed Baidu BOS asset structure

## Scope

This document is the Issue #73 inventory proposal only. The source archive remains unchanged: no legacy image is renamed, moved, deleted, copied into the repository, or uploaded to BOS by this change. Issue #70 owns selecting publishable assets, uploading them to BOS, and replacing archive paths with stable HTTPS URLs.

The exact source path for every image is recorded in `legacy-image-inventory.csv`. `apps/miniapp/src/config/assets.ts` contains the same case-sensitive source paths plus proposed future object keys; those object keys do not assert that an object already exists in BOS.

## Proposed object-key layout

```text
legacy/
└── xiaohai/
    ├── home/
    ├── shop/
    ├── stories/
    ├── ai/
    ├── pangzhu/
    ├── me/
    └── shared/
```

The filename segment should stay byte-for-byte identical to the legacy filename, including case and compound extensions such as `.png.jpeg`. Categorization is expressed only by the parent directory and manifest logical name.

## Mapping rules for Issue #70

1. Start from a manifest entry's `legacyPath`; do not locate a file by a guessed or normalized name.
2. Verify the source file hash against the reviewed Issue #73 archive before upload.
3. Upload only approved assets to the matching `proposedBosObjectPath`.
4. Preserve the original filename and extension exactly. Do not lowercase, transliterate, or remove a prefix such as `big_`.
5. Record the resulting stable HTTPS URL separately from the archive path.
6. Do not publish duplicate variants unless a distinct crop or resolution is intentionally required.
7. Do not publish `594fd60fb438ee6ed9d124daedd90e45.jpg` without content review because the image contains a visible AI-generated watermark.
8. Treat promotional prices and course claims embedded in images as time-sensitive content requiring business approval.

## Duplicate handling

The inventory identifies four secondary duplicate/derivative files:

- `big_881dd86d17ad6f8f698842805952fcb0.png` is pixel-identical to `881dd86d17ad6f8f698842805952fcb0.png`.
- `big_c0fc805c4697f92206e128ee5553f606.png` is pixel-identical to `c0fc805c4697f92206e128ee5553f606.png`.
- `big_3c0d665b10ed592b74b776074fa97fdf.jpg` is a resized/cropped product derivative of `3c0d665b10ed592b74b776074fa97fdf.jpg`.
- `big_72a31c645c7f6aa53740011e439c8dcc.jpg` is a resized/cropped product derivative of `72a31c645c7f6aa53740011e439c8dcc.jpg`.

Both members remain in the inventory and manifest for traceability. Issue #70 should choose one variant deliberately rather than deleting or overwriting the legacy source.

## Validation summary

- Archive regular-file entries: 76.
- Actual legacy directory payload: 37 images plus one `.DS_Store` file.
- macOS metadata: 38 `__MACOSX` resource-fork entries; excluded from the image inventory and manifest.
- Recognizable images: 37.
- Unknown images: 0.
- Secondary duplicates/derivatives: 4.
- Corrupt images: 0.
- Archive integrity: `unzip -t` passed.
- Every image was decoded successfully and its format/dimensions were inspected.
- Every `legacyPath` in the manifest was matched case-sensitively against a real ZIP entry.

## Decisions for Issue #70

- Confirm the production BOS bucket, region, public/private access boundary, CDN hostname, cache policy, and signed-URL requirements.
- Decide which duplicate/crop variants should be published.
- Confirm usage rights and whether promotional copy/prices remain valid.
- Approve or reject the watermarked image before any upload or consumer exposure.
