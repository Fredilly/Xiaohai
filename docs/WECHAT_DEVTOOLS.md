# WECHAT_DEVTOOLS.md — 微信开发者工具协作 / WeChat DevTools Workflow

## 原则 / Principle
WeChat DevTools is a runtime/debug/preview tool, **not the source of truth**. Git + local project files remain authoritative. No MCP is required.

## Workflow
```text
GitHub → local repo → Codex/IDE edits → WeChat DevTools watches/builds
→ simulator → real device → commit/PR
```

Open `apps/miniapp/` in WeChat DevTools after M1 creates it. Code is edited in the repository, not copied manually between tools.

## Each developer / 每位开发者
Each developer has:
- local clone of the canonical repo;
- WeChat DevTools installed;
- authorized developer access to the Mini Program/AppID;
- their own branch.

Never share personal WeChat credentials or production secrets through Git.

## What DevTools validates
Use DevTools/real devices for WeChat-specific behavior: `wx.login`, permissions, navigation/runtime, device APIs, sharing, payment integration, preview/upload and device differences.

Most domain logic, API, DB, validation and unit/integration tests must run outside DevTools so CI can verify them.

## Automation
Where supported by the installed DevTools version, use the official CLI/automation interface for preview/upload/test. Do not make CI depend on undocumented GUI automation. Confirm exact CLI commands against the installed version before wiring them.
