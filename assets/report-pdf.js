const PDF_MODULE_URL = 'https://esm.run/jspdf@2.5.2';

function cleanReportText(report) {
  const clone = report.cloneNode(true);
  clone.querySelectorAll('[data-pdf-export], button, input, meter').forEach(el => el.remove());
  return (clone.innerText || clone.textContent || '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function downloadReport(report, button, status) {
  button.disabled = true;
  status.textContent = 'Building PDF…';
  try {
    const { jsPDF } = await import(PDF_MODULE_URL);
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 48;
    const usable = pageWidth - margin * 2;
    let y = 58;

    const addPageChrome = () => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text('nishad.ai // MUSIC DOSSIER', margin, 30);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text('AI fiction / entertainment only', pageWidth - margin, 30, { align: 'right' });
    };

    addPageChrome();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.text('Music Intelligence Report', margin, y);
    y += 22;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(new Date().toLocaleString(), margin, y);
    y += 28;

    const text = cleanReportText(report);
    const paragraphs = text.split(/\n+/).filter(Boolean);
    doc.setFontSize(10.5);

    for (const paragraph of paragraphs) {
      const lines = doc.splitTextToSize(paragraph, usable);
      const blockHeight = lines.length * 14 + 8;
      if (y + blockHeight > pageHeight - 48) {
        doc.addPage();
        addPageChrome();
        y = 54;
      }
      doc.text(lines, margin, y);
      y += blockHeight;
    }

    const stamp = new Date().toISOString().slice(0, 10);
    doc.save(`nishad-ai-music-report-${stamp}.pdf`);
    status.textContent = 'PDF downloaded ✓';
  } catch (error) {
    console.error('PDF export failed', error);
    status.textContent = 'PDF export failed. Refresh and try again.';
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
