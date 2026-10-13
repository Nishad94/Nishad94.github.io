function cleanReportText(report) {
  const clone = report.cloneNode(true);
  clone.querySelectorAll('[data-pdf-export], button, input, meter').forEach(el => el.remove());
  return (clone.innerText || clone.textContent || '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function pdfSafeText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2022\u00B7]/g, '-')
    .replace(/[^\x20-\x7E\n]/g, '?');
}

function escapePdfString(value) {
  return pdfSafeText(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapText(text, maxChars = 88) {
  const lines = [];
  for (const paragraph of pdfSafeText(text).split(/\n+/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length <= maxChars) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        if (word.length <= maxChars) {
          line = word;
        } else {
          for (let i = 0; i < word.length; i += maxChars) {
            const chunk = word.slice(i, i + maxChars);
            if (chunk.length === maxChars) lines.push(chunk);
            else line = chunk;
          }
        }
      }
    }
    if (line) lines.push(line);
    lines.push('');
  }
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines;
}

function buildPdf(reportText) {
  const pageWidth = 595;
  const pageHeight = 842;
  const marginX = 48;
  const startY = 790;
  const bottomY = 52;
  const lineHeight = 14;
  const bodyFontSize = 10;
  const linesPerPage = Math.max(1, Math.floor((startY - bottomY) / lineHeight));

  const header = 'nishad.ai // MUSIC DOSSIER';
  const subtitle = 'AI fiction / entertainment only';
  const stamp = new Date().toLocaleString();
  const bodyLines = wrapText(reportText);
  const pages = [];

  for (let i = 0; i < bodyLines.length || i === 0; i += linesPerPage) {
    pages.push(bodyLines.slice(i, i + linesPerPage));
  }

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

  for (const pageLines of pages) {
    const content = [];
    content.push('BT');
    content.push(`/F2 10 Tf ${marginX} 812 Td (${escapePdfString(header)}) Tj`);
    content.push(`/F1 8 Tf 330 0 Td (${escapePdfString(subtitle)}) Tj`);
    content.push('ET');
    content.push('BT');
    content.push(`/F2 20 Tf ${marginX} 775 Td (${escapePdfString('Music Intelligence Report')}) Tj`);
    content.push(`/F1 9 Tf 0 -20 Td (${escapePdfString(stamp)}) Tj`);
    content.push('ET');
    content.push('BT');
    content.push(`/F1 ${bodyFontSize} Tf ${marginX} ${startY - 48} Td`);
    pageLines.forEach((line, index) => {
      if (index > 0) content.push(`0 -${lineHeight} Td`);
      content.push(`(${escapePdfString(line)}) Tj`);
    });
    content.push('ET');

    const stream = content.join('\n');
    const contentId = addObject(`<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`);
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(new TextEncoder().encode(pdf).length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new Blob([new TextEncoder().encode(pdf)], { type: 'application/pdf' });
}

export async function downloadReport(report, button, status) {
  button.disabled = true;
  status.textContent = 'Building PDF…';
  try {
    const text = cleanReportText(report);
    if (!text) throw new Error('Report is empty.');

    const blob = buildPdf(text);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `nishad-ai-music-report-${stamp}.pdf`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    status.textContent = 'PDF downloaded ✓';
  } catch (error) {
    console.error('PDF export failed', error);
    status.textContent = `PDF export failed: ${error?.message || String(error)}`;
    throw error;
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
