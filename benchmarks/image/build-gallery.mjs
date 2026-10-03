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
        return `<section class="model"><h3>${escapeHtml(model)}</h3>${runs.map((run) => `<article class="run" data-model="${escapeHtml(model)}" data-prompt-id="${escapeHtml(prompt.promptId)}" data-run-number="${run.runNumber}"><h4>Run ${run.runNumber}</h4><img src="${escapeHtml(run.outputReference)}" alt="${escapeHtml(model)} ${escapeHtml(prompt.promptId)} run ${run.runNumber}"><p>Latency: ${escapeHtml(run.generationLatencyMs)} ms</p><label>Character consistency 1–5 <input class="characterConsistency" type="number" min="1" max="5"></label><label>Prompt adherence 1–5 <input class="promptAdherence" type="number" min="1" max="5"></label><label>Illustration quality 1–5 <input class="illustrationQuality" type="number" min="1" max="5"></label><label>Notes <textarea class="notes"></textarea></label></article>`).join('')}</section>`;
      })
      .join('');
    return `<section class="prompt"><h2>${escapeHtml(prompt.promptId)}</h2><p class="prompt-text">${escapeHtml(prompt.prompt)}</p>${prompt.recurringCharacterDescription ? `<p class="recurring"><strong>Shared recurring character description:</strong> ${escapeHtml(recurring)}</p>` : ''}<div class="models">${cells}</div></section>`;
  })
  .join('');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Image Benchmark Gallery</title><style>body{font:16px system-ui,sans-serif;margin:2rem;background:#f6f4ef;color:#222}.prompt{background:#fff;padding:1rem;margin:1rem 0;border-radius:8px}.prompt-text,.recurring{max-width:80rem}.models{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.model{border:1px solid #ddd;padding:.75rem}.run{border-top:1px solid #ddd;padding:.75rem 0}.run img{display:block;width:100%;max-width:320px;aspect-ratio:1;object-fit:contain;background:#eee}.run label{display:block;margin:.35rem 0}.run input,.run textarea{display:block;width:100%;box-sizing:border-box}.run textarea{min-height:3rem}.recurring{background:#fff7d6;padding:.6rem}.toolbar{position:sticky;top:0;background:#fff;padding:1rem;border:1px solid #ddd;z-index:2}@media(max-width:800px){.models{grid-template-columns:1fr}}</style></head><body><h1>Qwen Image 3.0 vs Z-Image Turbo</h1><p>Offline manual review gallery. Ratings are saved locally in this browser only. No automatic visual scoring.</p><div class="toolbar"><button id="export">Export ratings JSON</button><button id="import">Import ratings JSON</button><input id="import-file" type="file" accept="application/json" hidden><button id="clear">Clear ratings</button><span id="status"></span></div><p>Settings: ${escapeHtml(JSON.stringify(settings))}</p>${cards}<script>(function(){const key='xiaohai-image-benchmark-ratings-v1';const fields=['characterConsistency','promptAdherence','illustrationQuality','notes'];const status=document.getElementById('status');const runs=()=>Array.from(document.querySelectorAll('.run'));const id=(run)=>[run.dataset.model,run.dataset.promptId,run.dataset.runNumber].join(':');const save=()=>{const ratings=runs().map(run=>{const item={model:run.dataset.model,promptId:run.dataset.promptId,runNumber:Number(run.dataset.runNumber)};fields.forEach(field=>{const value=run.querySelector('.'+field).value;item[field]=field==='notes'?value:(value?Number(value):null)});return item});localStorage.setItem(key,JSON.stringify(ratings));status.textContent=' Saved locally';};const restore=()=>{let ratings=[];try{ratings=JSON.parse(localStorage.getItem(key)||'[]')}catch{};const byId=new Map(ratings.map(item=>[id(item),item]));runs().forEach(run=>{const item=byId.get(id(run));if(item)fields.forEach(field=>{if(item[field]!==undefined&&item[field]!==null)run.querySelector('.'+field).value=item[field]})})};document.addEventListener('input',save);document.getElementById('clear').onclick=()=>{localStorage.removeItem(key);runs().forEach(run=>fields.forEach(field=>{run.querySelector('.'+field).value=''}));status.textContent=' Cleared'};document.getElementById('export').onclick=()=>{save();const blob=new Blob([localStorage.getItem(key)||'[]'],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='image-benchmark-ratings.json';link.click();URL.revokeObjectURL(link.href)};document.getElementById('import').onclick=()=>document.getElementById('import-file').click();document.getElementById('import-file').onchange=async(event)=>{try{const imported=JSON.parse(await event.target.files[0].text());if(!Array.isArray(imported))throw new Error();localStorage.setItem(key,JSON.stringify(imported));location.reload()}catch{status.textContent=' Invalid ratings JSON'}};restore()})();</script></body></html>`;
await writeFile(outputPath, `${html}\n`);
