import { readFile, writeFile } from 'node:fs/promises';

const rawPath = process.argv[2] ?? 'benchmarks/image/raw/raw-20261003T022843Z.json';
const outputPath = process.argv[3] ?? 'benchmarks/image/GALLERY.html';
const artifact = JSON.parse(await readFile(rawPath, 'utf8'));
const prompts = artifact.promptMatrix;
const runsByKey = new Map(
  artifact.runs.map((run) => [`${run.promptId}:${run.model}:${run.runNumber}`, run]),
);
const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/gu,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
const settings = prompts[0]?.settings ?? {};
const recurring = prompts.map((prompt) => prompt.recurringCharacterDescription).find(Boolean);
const cards = prompts
  .map((prompt) => {
    const cells = artifact.models
      .map((model) => {
        const runs = [1, 2, 3].map((runNumber) =>
          runsByKey.get(`${prompt.promptId}:${model}:${runNumber}`),
        );
        return `<section class="model"><h3>${escapeHtml(model)}</h3>${runs.map((run) => `<article class="run"><h4>Run ${run.runNumber}</h4><img src="${escapeHtml(run.outputReference)}" alt="${escapeHtml(model)} ${escapeHtml(prompt.promptId)} run ${run.runNumber}"><p>Latency: ${escapeHtml(run.generationLatencyMs)} ms</p><label>Character consistency 1–5 <input type="number" min="1" max="5"></label><label>Prompt adherence 1–5 <input type="number" min="1" max="5"></label><label>Illustration quality 1–5 <input type="number" min="1" max="5"></label><label>Notes <textarea></textarea></label></article>`).join('')}</section>`;
      })
      .join('');
    return `<section class="prompt"><h2>${escapeHtml(prompt.promptId)}</h2><p class="prompt-text">${escapeHtml(prompt.prompt)}</p>${prompt.recurringCharacterDescription ? `<p class="recurring"><strong>Shared recurring character description:</strong> ${escapeHtml(recurring)}</p>` : ''}<div class="models">${cells}</div></section>`;
  })
  .join('');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Image Benchmark Gallery</title><style>body{font:16px system-ui,sans-serif;margin:2rem;background:#f6f4ef;color:#222}.prompt{background:#fff;padding:1rem;margin:1rem 0;border-radius:8px}.prompt-text,.recurring{max-width:80rem}.models{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.model{border:1px solid #ddd;padding:.75rem}.run{border-top:1px solid #ddd;padding:.75rem 0}.run img{display:block;width:100%;max-width:320px;aspect-ratio:1;object-fit:contain;background:#eee}.run label{display:block;margin:.35rem 0}.run input,.run textarea{display:block;width:100%;box-sizing:border-box}.run textarea{min-height:3rem}.recurring{background:#fff7d6;padding:.6rem}@media(max-width:800px){.models{grid-template-columns:1fr}}</style></head><body><h1>Qwen Image 3.0 vs Z-Image Turbo</h1><p>Offline manual review gallery. No automatic visual scoring. Existing output references are used directly.</p><p>Settings: ${escapeHtml(JSON.stringify(settings))}</p>${cards}</body></html>`;
await writeFile(outputPath, `${html}\n`);
