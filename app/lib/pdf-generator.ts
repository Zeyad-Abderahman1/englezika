import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

type AccessCodeRow = {
  id: string;
  suffix: string;
  fullCode: string;
  videoTitle?: string;
};

function loadFontBase64(): string {
  try {
    const fontPath = getArabicFontPath();
    if (fs.existsSync(/*turbopackIgnore: true*/ fontPath)) {
      const fontBytes = fs.readFileSync(/*turbopackIgnore: true*/ fontPath);
      return fontBytes.toString('base64');
    }
  } catch {}
  return '';
}

function buildHTML(codes: AccessCodeRow[], fontBase64: string): string {
  const cards = codes
    .map(
      (c) => `
      <div class="card">
        <div class="code" dir="ltr">${escapeHtml(c.fullCode)}</div>
        ${c.videoTitle ? `<div class="name" dir="rtl" lang="ar">${escapeHtml(c.videoTitle)}</div>` : ''}
      </div>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<style>
  @font-face {
    font-family: 'NotoSansArabic';
    src: url(data:font/truetype;base64,${fontBase64}) format('truetype');
    font-weight: 400 700;
    font-style: normal;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  @page {
    size: A4;
    margin: 20mm;
  }

  body {
    font-family: 'NotoSansArabic', 'Segoe UI', Tahoma, Arial, sans-serif;
    direction: rtl;
    background: #fff;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    width: 100%;
  }

  .card {
    border: 1px solid #000;
    border-radius: 4px;
    padding: 14px 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 72px;
    background: #fff;
    page-break-inside: avoid;
    overflow: hidden;
  }

  .code {
    font-family: 'Courier New', Courier, monospace;
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.2px;
    text-align: center;
    direction: ltr;
    unicode-bidi: isolate;
    white-space: nowrap;
    color: #000;
    line-height: 1.3;
  }

  .name {
    font-family: 'NotoSansArabic', 'Segoe UI', Tahoma, Arial, sans-serif;
    font-size: 11px;
    font-weight: 600;
    text-align: center;
    direction: rtl;
    unicode-bidi: isolate;
    color: #000;
    margin-top: 6px;
    line-height: 1.4;
    word-break: break-word;
  }
</style>
</head>
<body>
  <div class="grid">
    ${cards}
  </div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getArabicFontPath(): string {
  const candidates = [
    path.join(process.cwd(), 'fonts', 'NotoSansArabic-Regular.ttf'),
    path.resolve(process.cwd(), '..', 'fonts', 'NotoSansArabic-Regular.ttf'),
    '/var/www/englizeka/fonts/NotoSansArabic-Regular.ttf',
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(/*turbopackIgnore: true*/ p)) return p;
    } catch {}
  }
  return path.join(process.cwd(), 'fonts', 'NotoSansArabic-Regular.ttf');
}

function findChrome(): string | null {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
    '/usr/lib/chromium-browser/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    try {
      if (fs.existsSync(/*turbopackIgnore: true*/ p)) return p;
    } catch {}
  }
  return null;
}

/**
 * Pure Node.js PDFKit fallback renderer when Chrome/Puppeteer is unavailable.
 */
async function generateAccessCodePDFKit(
  codes: AccessCodeRow[],
  _options?: { title?: string }
): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const fontPath = getArabicFontPath();
    const hasArabicFont = fs.existsSync(/*turbopackIgnore: true*/ fontPath);
    if (hasArabicFont) {
      doc.registerFont('NotoArabic', fontPath);
    }

    const pageWidth = doc.page.width - 80;
    const colWidth = (pageWidth - 16) / 2;
    const cardHeight = 65;
    const cardsPerPage = Math.floor((doc.page.height - 80) / (cardHeight + 12)) * 2;

    for (let i = 0; i < codes.length; i++) {
      const pageIndex = Math.floor(i / cardsPerPage);
      const indexOnPage = i % cardsPerPage;
      const row = Math.floor(indexOnPage / 2);
      const col = indexOnPage % 2;

      if (i > 0 && indexOnPage === 0) {
        doc.addPage();
      }

      const currentX = 40 + col * (colWidth + 16);
      const currentY = 40 + row * (cardHeight + 12);

      // Draw card border
      doc.rect(currentX, currentY, colWidth, cardHeight).lineWidth(1).stroke('#000000');

      // Draw code in monospace
      doc.font('Courier-Bold')
        .fontSize(10.5)
        .fillColor('#000000')
        .text(codes[i].fullCode, currentX + 6, currentY + 14, {
          width: colWidth - 12,
          align: 'center',
          lineBreak: false,
        });

      // Draw lecture title
      if (codes[i].videoTitle) {
        if (hasArabicFont) {
          doc.font('NotoArabic').fontSize(9.5);
        } else {
          doc.font('Helvetica-Bold').fontSize(9.5);
        }
        doc.fillColor('#333333')
          .text(codes[i].videoTitle!, currentX + 6, currentY + 36, {
            width: colWidth - 12,
            align: 'center',
            lineBreak: false,
          });
      }
    }

    doc.end();
  });
}

/**
 * Generate a printable PDF of access codes.
 * Uses Puppeteer + HTML/CSS if Chrome is installed; falls back to pure-Node PDFKit.
 */
export async function generateAccessCodePDF(
  codes: AccessCodeRow[],
  options?: { title?: string }
): Promise<Buffer> {
  const executablePath = findChrome();

  if (executablePath) {
    try {
      const fontBase64 = loadFontBase64();
      const html = buildHTML(codes, fontBase64);

      const browser = await puppeteer.launch({
        executablePath,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      });

      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'load' });
        const pdf = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' },
        });
        return Buffer.from(pdf);
      } finally {
        await browser.close();
      }
    } catch (puppeteerErr) {
      console.warn('[PDF] Puppeteer rendering failed, falling back to PDFKit:', puppeteerErr);
    }
  }

  return generateAccessCodePDFKit(codes, options);
}
