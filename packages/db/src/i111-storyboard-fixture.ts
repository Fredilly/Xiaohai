/**
 * Issue #111 isolated Mac Plan B fixture ONLY. This is not a product storyboard
 * generator and does not impersonate a successful AI text job.
 */
export const I111_BOOK_ID = '90d7f77e-ae23-40ef-90b6-a672412c6318';
export const I111_OWNER_ID = '11111111-1111-4111-8111-111111111111';
export const I111_DATABASE = 'xiaohai_i111_mac_20261116';

const SCENES = [
  'Mimi walks beside a forest stream at sunrise while Pip flies just above the water.',
  'Mimi and Pip sit under a friendly tree sharing a paper map in warm afternoon light.',
];
const STORIES = [
  '清晨，Mimi 沿着森林溪流散步，Pip 轻轻飞过水面。',
  '温暖的午后，Mimi 和 Pip 坐在树下，一起分享一张纸质地图。',
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export type I111FixturePage = {
  pageNumber: number;
  pageKind: 'COVER' | 'CONTENT';
  storyText: string | null;
  sceneDescription: string;
  illustrationPrompt: string;
  characterIds: string[];
};

export function validateI111LocalTarget(env: NodeJS.ProcessEnv): string {
  if (env.APP_ENV !== 'dev' || env.NODE_ENV === 'production' || env.NODE_ENV === 'test') {
    throw new Error('I111_ENVIRONMENT_NOT_DEV');
  }
  if (!env.DATABASE_URL) throw new Error('I111_DATABASE_URL_MISSING');
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    throw new Error('I111_DATABASE_URL_INVALID');
  }
  if (
    url.protocol !== 'postgresql:' ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '52511' ||
    url.pathname !== '/' + I111_DATABASE ||
    decodeURIComponent(url.username) !== 'xiaohai_i111_app' ||
    !url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('I111_DATABASE_ALLOWLIST_REJECTED');
  }
  return env.DATABASE_URL;
}

export function createI111FixturePages(
  raw: unknown,
  characterIds: { mimi: string; pip: string },
): I111FixturePage[] {
  if (!UUID.test(characterIds.mimi) || !UUID.test(characterIds.pip)) {
    throw new Error('I111_CHARACTER_ID_INVALID');
  }
  if (characterIds.mimi === characterIds.pip) throw new Error('I111_CHARACTER_IDS_NOT_DISTINCT');
  if (typeof raw !== 'object' || raw === null) throw new Error('I111_FIXTURE_INVALID');
  const fixture = raw as {
    schemaVersion?: unknown;
    fixtureId?: unknown;
    realGenerationPolicy?: { authorized?: unknown };
    characters?: Array<Record<string, unknown>>;
    pages?: Array<{ pageKey?: string; scene?: string; characters?: string[] }>;
    visualStyle?: Record<string, unknown>;
    regenerationPlan?: Record<string, unknown>;
  };
  if (
    fixture.schemaVersion !== 1 ||
    fixture.fixtureId !== 'm10-two-character-two-page-v1' ||
    fixture.realGenerationPolicy?.authorized !== false ||
    !Array.isArray(fixture.characters) ||
    fixture.characters.length !== 2 ||
    !Array.isArray(fixture.pages) ||
    fixture.pages.length !== 2 ||
    fixture.regenerationPlan?.requiredPage !== 'page-2' ||
    fixture.regenerationPlan?.implicitRetryAllowed !== false
  ) {
    throw new Error('I111_FROZEN_FIXTURE_MISMATCH');
  }
  const [mimi, pip] = fixture.characters;
  if (
    mimi?.key !== 'mimi' ||
    mimi.name !== 'Mimi' ||
    mimi.identity !== 'five-year-old red panda child' ||
    mimi.clothing !== 'yellow knit scarf, blue overalls' ||
    mimi.accessories !== 'small red satchel' ||
    pip?.key !== 'pip' ||
    pip.name !== 'Pip' ||
    pip.identity !== 'small sky-blue bird child' ||
    pip.clothing !== 'green cap, yellow striped knit scarf' ||
    pip.accessories !== 'tiny orange satchel'
  ) {
    throw new Error('I111_FROZEN_CHARACTER_MISMATCH');
  }
  const style = fixture.visualStyle;
  if (
    style?.medium !== 'bright polished cartoon storybook illustration' ||
    typeof style.lighting !== 'string' ||
    typeof style.lineAndTexture !== 'string' ||
    typeof style.composition !== 'string'
  ) {
    throw new Error('I111_FROZEN_STYLE_MISMATCH');
  }
  for (let index = 0; index < 2; index += 1) {
    const page = fixture.pages[index];
    if (
      page?.pageKey !== 'page-' + (index + 1) ||
      page.scene !== SCENES[index] ||
      JSON.stringify(page.characters) !== JSON.stringify(['mimi', 'pip'])
    ) {
      throw new Error('I111_FROZEN_SCENE_MISMATCH');
    }
  }
  const referenceConstraints = [
    'Exactly two characters, Mimi and Pip. Same faces, clothes, accessories, colors and childlike proportions across pages.',
    'Mimi: five-year-old rust-orange red panda child; round brown eyes; yellow knit scarf; blue overalls; small red satchel.',
    'Pip: small sky-blue bird child; rounded beak; green cap; yellow striped knit scarf; tiny orange satchel.',
    'No written text, lettering, extra characters, garbled symbols, duplicate limbs or photorealism.',
  ];
  const renderPrompt = (scene: string, cover: boolean) =>
    [
      cover ? 'Storybook COVER, same characters and no additional story event.' : 'Storybook PAGE.',
      'Scene: ' + scene,
      'Style: ' + style.medium + '. ' + style.lighting + '. ' + style.lineAndTexture + '. ' + style.composition + '.',
      ...referenceConstraints,
    ].join('\n');

  return [
    {
      pageNumber: 0,
      pageKind: 'COVER',
      storyText: null,
      sceneDescription: SCENES[0]!,
      illustrationPrompt: renderPrompt(SCENES[0]!, true),
      characterIds: [characterIds.mimi, characterIds.pip],
    },
    ...SCENES.map((scene, index) => ({
      pageNumber: index + 1,
      pageKind: 'CONTENT' as const,
      storyText: STORIES[index]!,
      sceneDescription: scene,
      illustrationPrompt: renderPrompt(scene, false),
      characterIds: [characterIds.mimi, characterIds.pip],
    })),
  ];
}

export function matchExistingI111Pages(
  actual: Array<{
    page_number: number;
    page_kind: string;
    story_text: string | null;
    scene_description: string | null;
    illustration_prompt: string | null;
    character_ids: string[];
    source_ai_job_id: string | null;
  }>,
  expected: I111FixturePage[],
): boolean {
  if (actual.length !== expected.length) return false;
  return actual.every((page, index) => {
    const candidate = expected[index]!;
    return (
      page.page_number === candidate.pageNumber &&
      page.page_kind === candidate.pageKind &&
      page.story_text === candidate.storyText &&
      page.scene_description === candidate.sceneDescription &&
      page.illustration_prompt === candidate.illustrationPrompt &&
      JSON.stringify(page.character_ids) === JSON.stringify(candidate.characterIds) &&
      page.source_ai_job_id === null
    );
  });
}
