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
| DevTools screen-by-screen manual evidence | PARTIAL PASS | 2026-11-13: storyboard apply persisted cover + 10 pages, read-only preview navigated successfully, and the saved book reopened; real illustration/failure states were not tested |
| Real-device screen-by-screen evidence | BLOCKED / PENDING | #76 code supplies a candidate HTTPS staging endpoint; an authorized AppID, WeChat domain allowlist and real iOS/Android proof are still required |
| Controlled real end-to-end paid flow | PENDING OPERATION AUTHORIZATION | requires current server-side cost cap, trustworthy runtime evidence and a separately scoped paid-operation grant |

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

## Accepted partial DevTools run and remaining scope

The [2026-11-13 Issue #112 checkpoint](https://github.com/Fredilly/Xiaohai/issues/112)
records a real WeChat DevTools **local** run after #224 merged. An existing successful
storyboard Job was applied **without another provider request** (HTTP 200), storing
11 segments (cover + 10 content pages) and two locked characters. The user inspected
the workbench, scrolled the full-book read-only preview, returned, and reopened the
same saved work from “我的绘本”. Screenshots were viewed during the session but are
not attached as an auditable artifact; the result is not real-device acceptance.

The later offline regression coverage for #112 additionally verifies that timed-out
illustration/reference jobs remain identified as potentially active; submission
failure is distinguished from an accepted job's failed status read; a read-only
refresh does not submit a second paid request; and stale list responses cannot
replace newer signed cover URLs or restore private books after logout. Those checks
do **not** substitute for a controlled real illustration/failure run.

## Manual DevTools checklist

The mock/local storyboard → preview → reopen steps below were exercised on
2026-11-13. Preserve that partial result; rerun only if the environment or code
changes invalidate it. The remaining failure/real-image cases still need runtime
proof. The full verification sequence is:

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

- Real-device acceptance requires an authorized test AppID, an actually WeChat-allowlisted HTTPS API domain and iOS/Android evidence. The #76 code change alone does not verify these conditions.
- One real end-to-end flow may run only under a current, exact-scope paid-operation grant and the existing server-side budget cap/preflight checks.
- Never include API keys, private prompts, signed URLs, or provider response bodies in screenshots/issues/PRs.
