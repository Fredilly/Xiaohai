export const recurringCharacterDescription =
  'Mimi, a gentle five-year-old red panda child with rust-orange fur, round brown eyes, a yellow knit scarf, blue overalls, and a small red satchel.';

export type ImagePrompt = {
  promptId: string;
  category: string;
  prompt: string;
};

export const imagePrompts: ImagePrompt[] = [
  {
    promptId: 'portrait-child-friendly',
    category: 'simple child-friendly character portrait',
    prompt: `A simple child-friendly storybook portrait of ${recurringCharacterDescription}, centered, soft shapes, warm colors, clean background.`,
  },
  {
    promptId: 'same-character-new-scene',
    category: 'same character in a new scene',
    prompt: `The same character, ${recurringCharacterDescription}, standing beside a forest stream at sunrise, child-friendly picture-book illustration, warm light.`,
  },
  {
    promptId: 'two-recurring-characters',
    category: 'two recurring characters together',
    prompt: `Mimi is joined by Pip, a small sky-blue bird child with a pale yellow belly, a green cap, and a tiny orange satchel. Keep Mimi exactly as described: ${recurringCharacterDescription} Show both recurring characters sharing a map under a friendly tree, children's storybook illustration.`,
  },
  {
    promptId: 'detailed-indoor-scene',
    category: 'detailed indoor scene',
    prompt:
      "A detailed cozy children's library inside a treehouse, picture books, wooden shelves, round window, cushions, warm lamplight, safe storybook illustration, no people.",
  },
  {
    promptId: 'outdoor-action-scene',
    category: 'outdoor action scene',
    prompt:
      "A child-friendly outdoor action scene of a small fox and bird crossing stepping stones over a shallow sparkling stream, clear motion, joyful expressions, warm children's-book illustration.",
  },
  {
    promptId: 'chinese-book-visible-text',
    category: "Chinese children's-book illustration with visible text",
    prompt:
      "A Chinese children's-book illustration of a smiling little fox and bird in a sunny forest, with a clean readable sign that says exactly “勇敢回家”, harmonious layout, warm watercolor style.",
  },
];
