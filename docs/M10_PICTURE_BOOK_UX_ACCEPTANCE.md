# M10 Picture Book UX Acceptance / 绘本端到端 UX 验收

Issue: #112

## PRD boundary

PRD V3.2 defines the Picture Book flow as:

story → character setup → pagination/storyboard → illustration → layout → cover → full-book preview → save.

PDF/printing is described as future-facing capability ("预留 PDF/印刷"), so this issue verifies whether export exists. It does not silently turn PDF into a launch requirement.

## Automated evidence in this branch

| Acceptance item | Status | Evidence |
| --- | --- | --- |
| Story BODY can create a Picture Book | PASS | existing Story → Picture Book Mini Program/API flow |
| Character Bible edit / save / reference select / confirm / reopen | PASS | existing Mini Program + API integration tests |
| Storyboard creation after locked characters | PASS | existing PostgreSQL M10 integration tests |
| Cover before content pages | PASS | API reopen persistence regression + preview helper test |
| Content pages ordered by page number | PASS | API reopen persistence regression + preview helper test |
| Real image linkage survives reopen | PASS | BAIDU_BOS READY media persisted and returned after new service read |
| Failed newer regeneration does not erase older valid preview image | PASS | read-only preview helper selects latest valid real READY revision |
| Failed-only page is visible as failed, not silently retried | PASS | preview state test; preview page never calls generation APIs |
| Existing work can be reopened from "我的绘本" | PASS | list/detail API + persistence regression |
| Full-book read-only preview | PASS | new `pages/picture-book-preview` route |
| PDF / printing export | NOT IMPLEMENTED | no export/PDF route or Mini Program capability exists; PRD marks it future-facing |
| Mock flow automated | PASS | Mini Program preview tests + PostgreSQL integration |
| DevTools screen-by-screen manual evidence | PENDING MANUAL | requires opening the Mini Program UI and recording screenshots |
| Real-device screen-by-screen evidence | BLOCKED / PENDING | #76 must provide a real public HTTPS API endpoint for device access |
| Controlled real end-to-end paid flow | PENDING OWNER APPROVAL | requires server-side cap approval; no real provider call is made by this branch |

## Read-only preview behavior

The new preview page intentionally has no generation, regenerate, or retry-paid action.

It:

1. loads the persisted Picture Book detail;
2. places the cover first;
3. sorts content pages by page number;
4. displays the latest valid real READY image (non-MOCK with media + playback URL);
5. retains the last valid image if a newer explicit regeneration failed;
6. shows pending/failed/missing states without issuing another generation request;
7. states clearly that PDF/printing export is not available in the current release scope.

## Manual DevTools checklist

When running the mock/local flow in WeChat DevTools, capture evidence for:

1. Story work with saved BODY → "从最新正文创建绘本".
2. Picture Book creation opens the workbench.
3. Character fields can be edited and saved before lock.
4. Reference selection + confirm locks characters.
5. Storyboard generation creates cover + numbered pages.
6. "打开只读整书预览" opens the new preview page.
7. Cover appears before numbered content pages.
8. Return to "我的绘本", reopen the same book, and verify the same persisted pages/images.
9. Simulate/observe a FAILED revision and verify no automatic paid retry occurs.
10. Verify the UI reports PDF/printing export as unavailable rather than presenting a fake export action.

## Real-device and paid acceptance

Do not claim these are complete in this issue until evidence exists.

- Real-device acceptance depends on #76 removing device dependence on `127.0.0.1` and providing a WeChat-allowlisted HTTPS API.
- One real end-to-end flow may run only after explicit owner approval and the existing server-side budget cap/preflight checks.
- Never include API keys, private prompts, signed URLs, or provider response bodies in screenshots/issues/PRs.
