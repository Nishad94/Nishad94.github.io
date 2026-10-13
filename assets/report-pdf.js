function normalizedBlockText(element) {
  return (element.textContent || '').replace(/\s+/g, ' ').trim();
}

function collectReportBlocks(element, blocks) {
  for (const child of element.children) {
    const tag = child.tagName;
    if (/^H[1-6]$/.test(tag)) {
      const text = normalizedBlockText(child);
      if (text) blocks.push({ kind: 'heading', text });
      continue;
    }
    if (tag === 'P') {
      const text = normalizedBlockText(child);
      if (!text) continue;
      const kind = child.classList.contains('yellow') ? 'callout' :
        child.classList.contains('dim') ? 'note' : 'body';
      blocks.push({ kind, text });
      continue;
    }
    if (tag === 'LI') {
      const text = normalizedBlockText(child);
      if (text) blocks.push({ kind: 'bullet', text });
      continue;
    }
    if (tag === 'LABEL' || tag === 'SUMMARY') {
      const text = normalizedBlockText(child);
      if (text) blocks.push({ kind: 'note', text });
      continue;
    }
    collectReportBlocks(child, blocks);
  }
}

export function extractReportBlocks(report) {
  const clone = report.cloneNode(true);
  clone.querySelectorAll('[data-pdf-export], button, input, meter').forEach(element => element.remove());
  const blocks = [];
  collectReportBlocks(clone, blocks);
  return blocks;
}

export function cleanReportText(report) {
  return extractReportBlocks(report).map(block => block.text).join('\n\n').trim();
}

function pdfSafeText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2022\u00B7]/g, '-')
    .replace(/[^\x20-\x7E\n]+/g, '*');
}

function escapePdfString(value) {
  return pdfSafeText(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapText(text, maxChars) {
  const words = pdfSafeText(text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (word.length <= maxChars) {
      line = word;
      continue;
    }
    line = '';
    for (let index = 0; index < word.length; index += maxChars) {
      const chunk = word.slice(index, index + maxChars);
      if (chunk.length === maxChars) lines.push(chunk);
      else line = chunk;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

const COLORS = {
  background: '0.051 0.059 0.106',
  panel: '0.090 0.098 0.176',
  panelSoft: '0.075 0.082 0.145',
  ink: '0.969 0.957 1.000',
  muted: '0.671 0.659 0.784',
  line: '0.204 0.216 0.329',
  mint: '0.624 1.000 0.824',
  yellow: '1.000 0.914 0.651',
  pink: '1.000 0.608 0.839',
  purple: '0.725 0.643 1.000'
};

const ACCENTS = [COLORS.mint, COLORS.purple, COLORS.yellow, COLORS.pink];

function fillRect(content, x, y, width, height, color) {
  content.push(`${color} rg`);
  content.push(`${x} ${y} ${width} ${height} re f`);
}

function strokeRect(content, x, y, width, height, color, lineWidth = 0.7) {
  content.push(`${color} RG`);
  content.push(`${lineWidth} w`);
  content.push(`${x} ${y} ${width} ${height} re S`);
}

function drawText(content, text, x, y, { font = 'F1', size = 10, color = COLORS.ink } = {}) {
  content.push('BT');
  content.push(`${color} rg`);
  content.push(`/${font} ${size} Tf`);
  content.push(`${x} ${y} Td`);
  content.push(`(${escapePdfString(text)}) Tj`);
  content.push('ET');
}

function drawLines(content, lines, x, startY, options = {}) {
  const lineHeight = options.lineHeight || 13;
  lines.forEach((line, index) => drawText(content, line, x, startY - index * lineHeight, options));
}

function itemLayout(block) {
  if (block.kind === 'heading') {
    const lines = wrapText(block.text, 64);
    return { ...block, lines, height: Math.max(34, 17 + lines.length * 13), gap: 9 };
  }
  if (block.kind === 'callout') {
    const lines = wrapText(block.text, 82);
    return { ...block, lines, height: 24 + lines.length * 12, gap: 10 };
  }
  const lines = wrapText(block.kind === 'bullet' ? `> ${block.text}` : block.text, block.kind === 'note' ? 92 : 88);
  return {
    ...block, lines,
    height: lines.length * (block.kind === 'note' ? 11 : 12.5) + 9,
    gap: block.kind === 'note' ? 7 : 10
  };
}

function pageHeader(content, firstPage, stamp) {
  fillRect(content, 0, 0, 595, 842, COLORS.background);
  if (firstPage) {
    fillRect(content, 32, 730, 531, 80, COLORS.panel);
    fillRect(content, 32, 730, 5, 80, COLORS.mint);
    fillRect(content, 37, 730, 2, 80, COLORS.purple);
    drawText(content, 'NISHAD.AI // MUSIC DOSSIER', 52, 790, { font: 'F2', size: 9, color: COLORS.mint });
    drawText(content, '[ REPORT://LOCAL ]', 439, 790, { font: 'F2', size: 8, color: COLORS.purple });
    drawText(content, 'Music Intelligence Report', 52, 758, { font: 'F2', size: 22, color: COLORS.ink });
    drawText(content, `generated in browser // ${stamp}`, 52, 740, { size: 8, color: COLORS.muted });
    return 708;
  }
  drawText(content, 'NISHAD.AI // MUSIC DOSSIER', 38, 802, { font: 'F2', size: 9, color: COLORS.mint });
  drawText(content, 'CONTINUED', 492, 802, { font: 'F2', size: 8, color: COLORS.purple });
  fillRect(content, 38, 788, 519, 1, COLORS.line);
  return 766;
}

function pageFooter(content, pageNumber) {
  fillRect(content, 38, 42, 519, 1, COLORS.line);
  drawText(content, 'AI FICTION / ENTERTAINMENT ONLY', 38, 25, { font: 'F2', size: 7.5, color: COLORS.muted });
  drawText(content, `PAGE ${String(pageNumber).padStart(2, '0')} // nishad.ai`, 448, 25, { font: 'F2', size: 7.5, color: COLORS.mint });
}

export function buildPdf(blocks) {
  const pageWidth = 595;
  const pageHeight = 842;
  const bottomY = 58;
  const stamp = new Date().toLocaleString();
  const items = blocks.map(itemLayout);
  const pages = [];
  let page = null;
  let cursor = 0;
  let headingIndex = 0;
  let currentAccent = COLORS.mint;

  function newPage() {
    if (page) pageFooter(page, pages.length);
    page = [];
    pages.push(page);
    cursor = pageHeader(page, pages.length === 1, stamp);
  }

  newPage();
  items.forEach((item, index) => {
    const next = items[index + 1];
    const keepWithNext = item.kind === 'heading' && next ? Math.min(next.height, 54) : 0;
    if (cursor - item.height - item.gap - keepWithNext < bottomY) newPage();

    if (item.kind === 'heading') {
      currentAccent = ACCENTS[headingIndex++ % ACCENTS.length];
      const y = cursor - item.height;
      fillRect(page, 38, y, 519, item.height, COLORS.panel);
      fillRect(page, 38, y, 5, item.height, currentAccent);
      strokeRect(page, 38, y, 519, item.height, COLORS.line, 0.5);
      drawLines(page, item.lines, 54, cursor - 21, {
        font: 'F2', size: 10.5, lineHeight: 13, color: currentAccent
      });
    } else if (item.kind === 'callout') {
      const y = cursor - item.height;
      fillRect(page, 38, y, 519, item.height, COLORS.panelSoft);
      strokeRect(page, 38, y, 519, item.height, COLORS.yellow, 0.8);
      drawText(page, 'NOTICE', 51, cursor - 17, { font: 'F2', size: 7.5, color: COLORS.yellow });
      drawLines(page, item.lines, 51, cursor - 32, {
        size: 8.8, lineHeight: 12, color: COLORS.ink
      });
    } else {
      const lineHeight = item.kind === 'note' ? 11 : 12.5;
      const fontSize = item.kind === 'note' ? 8.2 : 9.3;
      const color = item.kind === 'note' ? COLORS.muted : COLORS.ink;
      const railHeight = Math.max(8, item.height - 6);
      fillRect(page, 42, cursor - railHeight + 1, 2, railHeight, currentAccent);
      drawLines(page, item.lines, 53, cursor - 12, {
        font: item.kind === 'bullet' ? 'F2' : 'F1',
        size: fontSize, lineHeight, color
      });
    }
    cursor -= item.height + item.gap;
  });
  pageFooter(page, pages.length);

  const objects = [];
  const addObject = body => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = addObject('');
  const pagesId = addObject('');
  const fontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const boldFontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const pageIds = [];

  for (const content of pages) {
    const stream = content.join('\n');
    const contentId = addObject(`<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`);
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(new TextEncoder().encode(pdf).length);
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let index = 1; index < offsets.length; index++) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([new TextEncoder().encode(pdf)], { type: 'application/pdf' });
}

export async function downloadReport(report, button, status) {
  button.disabled = true;
  status.textContent = 'Preparing themed PDF…';
  await new Promise(resolve => setTimeout(resolve, 0));
  try {
    const blocks = extractReportBlocks(report);
    if (!blocks.length) throw new Error('Report is empty.');
    const blob = buildPdf(blocks);
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `nishad-ai-music-report-${stamp}.pdf`;
    const oldLink = status.querySelector('a');
    if (oldLink?.dataset.blobUrl) URL.revokeObjectURL(oldLink.dataset.blobUrl);
    status.replaceChildren();
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.dataset.blobUrl = url;
    link.textContent = 'Save PDF manually';
    link.style.cssText = 'text-decoration:underline;color:inherit';
    status.append('Themed PDF ready · ', link);
    const auto = link.cloneNode(true);
    auto.style.display = 'none';
    document.body.appendChild(auto);
    auto.click();
    auto.remove();
  } catch (error) {
    console.error('PDF export failed', error);
    status.textContent = `PDF export failed: ${error?.message || String(error)}`;
  } finally {
    button.disabled = false;
  }
}

function install(report) {
  if (!(report instanceof HTMLElement) || report.dataset.pdfReady === 'true') return;
  report.dataset.pdfReady = 'true';
  const controls = document.createElement('div');
  controls.dataset.pdfExport = 'true';
  controls.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:18px';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn';
  button.textContent = '⬇ Download PDF';

  const status = document.createElement('span');
  status.style.cssText = 'font-size:11px;color:var(--muted)';
  status.setAttribute('role', 'status');

  button.addEventListener('click', () => downloadReport(report, button, status));
  controls.append(button, status);
  report.appendChild(controls);
}

function scan(root = document) {
  root.querySelectorAll?.('.vibe-report').forEach(install);
}

if (typeof document !== 'undefined') {
  scan();
  new MutationObserver(records => {
    for (const record of records) {
      for (const added of record.addedNodes) {
        if (!(added instanceof Element)) continue;
        if (added.matches?.('.vibe-report')) install(added);
        scan(added);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}
