import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  createI111FixturePages,
  matchExistingI111Pages,
  I111_BOOK_ID,
  I111_DATABASE,
  I111_OWNER_ID,
  validateI111LocalTarget,
} from '../src/i111-storyboard-fixture.js';

const fixture = JSON.parse(
  readFileSync(new URL('../../../benchmarks/picture-book-quality/FIXTURE.json', import.meta.url), 'utf8'),
);
const ids = {
  mimi: 'de0169d8-d975-4f1b-b04c-a15c25f54bdc',
  pip: '249a719e-d284-46e0-a525-285e93270248',
};
const copy = () => structuredClone(fixture);
const mapped = () => createI111FixturePages(copy(), ids);
const existing = () =>
  mapped().map((p) => ({
    page_number: p.pageNumber,
    page_kind: p.pageKind,
    story_text: p.storyText,
    scene_description: p.sceneDescription,
    illustration_prompt: p.illustrationPrompt,
    character_ids: p.characterIds,
    source_ai_job_id: null,
  }));

describe('Issue #111 isolated storyboard fixture', () => {
  it('binds only the known book, owner, database and approved two-scene setup', () => {
    expect(I111_BOOK_ID).toBe('90d7f77e-ae23-40ef-90b6-a672412c6318');
    expect(I111_OWNER_ID).toBe('11111111-1111-4111-8111-111111111111');
    expect(I111_DATABASE).toBe('xiaohai_i111_mac_20261116');
    const pages = mapped();
    expect(pages.map((p) => [p.pageNumber, p.pageKind])).toEqual([
      [0, 'COVER'],
      [1, 'CONTENT'],
      [2, 'CONTENT'],
    ]);
    expect(pages[0]?.storyText).toBeNull();
    expect(pages[0]?.sceneDescription).toBe(pages[1]?.sceneDescription);
    expect(pages[1]?.storyText).toBe('清晨，Mimi 沿着森林溪流散步，Pip 轻轻飞过水面。');
    expect(pages[2]?.storyText).toBe('温暖的午后，Mimi 和 Pip 坐在树下，一起分享一张纸质地图。');
    for (const page of pages) {
      expect(page.characterIds).toEqual([ids.mimi, ids.pip]);
      expect(page.illustrationPrompt).toContain('yellow striped knit scarf');
      expect(page.illustrationPrompt).toContain('No written text');
      expect(page.illustrationPrompt).toContain(page.sceneDescription);
    }
  });

  it('fails on any altered frozen scenes, roles, model policy or visual style', () => {
    const changed = copy();
    changed.pages[1].scene = 'A different adventure.';
    expect(() => createI111FixturePages(changed, ids)).toThrow('I111_FROZEN_SCENE_MISMATCH');
    const extra = copy();
    extra.pages.push(extra.pages[1]);
    expect(() => createI111FixturePages(extra, ids)).toThrow('I111_FROZEN_FIXTURE_MISMATCH');
    const visual = copy();
    visual.characters[1].clothing = 'no scarf';
    expect(() => createI111FixturePages(visual, ids)).toThrow('I111_FROZEN_CHARACTER_MISMATCH');
    const authorized = copy();
    authorized.realGenerationPolicy.authorized = true;
    expect(() => createI111FixturePages(authorized, ids)).toThrow('I111_FROZEN_FIXTURE_MISMATCH');
    const style = copy();
    style.visualStyle.medium = 'photorealistic';
    expect(() => createI111FixturePages(style, ids)).toThrow('I111_FROZEN_STYLE_MISMATCH');
  });

  it('rejects duplicate, malformed, or swapped identity bindings', () => {
    expect(() => createI111FixturePages(copy(), { mimi: ids.mimi, pip: ids.mimi })).toThrow(
      'I111_CHARACTER_IDS_NOT_DISTINCT',
    );
    expect(() => createI111FixturePages(copy(), { mimi: 'mimi', pip: ids.pip })).toThrow(
      'I111_CHARACTER_ID_INVALID',
    );
  });

  it('treats the exact original pages as an idempotent no-op but refuses conflicts', () => {
    const expected = mapped();
    const rows = existing();
    expect(matchExistingI111Pages(rows, expected)).toBe(true);
    expect(matchExistingI111Pages(rows.slice(1), expected)).toBe(false);
    const changedPage = structuredClone(rows);
    changedPage[2]!.illustration_prompt = 'A different prompt';
    expect(matchExistingI111Pages(changedPage, expected)).toBe(false);
    const forgedJob = structuredClone(rows);
    forgedJob[1]!.source_ai_job_id = ids.mimi;
    expect(matchExistingI111Pages(forgedJob, expected)).toBe(false);
    const swapped = structuredClone(rows);
    swapped[1]!.character_ids = [ids.pip, ids.mimi];
    expect(matchExistingI111Pages(swapped, expected)).toBe(false);
  });
});

describe('Issue #111 local database target allowlist', () => {
  const valid = {
    APP_ENV: 'dev',
    DATABASE_URL:
      'postgresql://xiaohai_i111_app:synthetic-password@127.0.0.1:52511/xiaohai_i111_mac_20261116',
  };
  it('accepts only the exact isolated localhost app database', () => {
    expect(validateI111LocalTarget(valid)).toBe(valid.DATABASE_URL);
  });
  it('rejects other DB names, ports, remote hosts, users and connection options', () => {
    for (const changed of [
      valid.DATABASE_URL.replace('52511', '5432'),
      valid.DATABASE_URL.replace('127.0.0.1', 'staging-db.internal'),
      valid.DATABASE_URL.replace('xiaohai_i111_mac_20261116', 'xiaohai_prod'),
      valid.DATABASE_URL.replace('xiaohai_i111_app', 'postgres'),
      valid.DATABASE_URL + '?sslmode=disable',
      valid.DATABASE_URL.replace('postgresql:', 'http:'),
    ]) {
      expect(() => validateI111LocalTarget({ ...valid, DATABASE_URL: changed })).toThrow(
        'I111_DATABASE_ALLOWLIST_REJECTED',
      );
    }
  });
  it('rejects missing context, non-dev environments, and absent credentials', () => {
    expect(() => validateI111LocalTarget({ DATABASE_URL: valid.DATABASE_URL })).toThrow(
      'I111_ENVIRONMENT_NOT_DEV',
    );
    expect(() => validateI111LocalTarget({ ...valid, APP_ENV: 'staging' })).toThrow(
      'I111_ENVIRONMENT_NOT_DEV',
    );
    expect(() => validateI111LocalTarget({ ...valid, NODE_ENV: 'test' })).toThrow(
      'I111_ENVIRONMENT_NOT_DEV',
    );
    expect(() => validateI111LocalTarget({ APP_ENV: 'dev' })).toThrow(
      'I111_DATABASE_URL_MISSING',
    );
  });
});
