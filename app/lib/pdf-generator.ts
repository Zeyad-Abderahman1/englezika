import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import { buildLectureQRUrl } from './lecture-access-codes';

export type AccessCodeRow = {
  id: string;
  suffix: string;
  fullCode?: string;
  token?: string;
  url?: string;
  videoTitle?: string;
  courseTitle?: string;
};

export type QRCodeRow = AccessCodeRow;

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

type PreparedQRCard = {
  id: string;
  suffix: string;
  targetUrl: string;
  videoTitle: string;
  courseTitle?: string;
  qrDataUrl: string;
  qrBuffer?: Buffer;
};

async function prepareQRCards(codes: AccessCodeRow[]): Promise<PreparedQRCard[]> {
  const prepared: PreparedQRCard[] = [];
  for (const c of codes) {
    const tokenOrCode = c.token || c.fullCode || '';
    const targetUrl = c.url || (tokenOrCode ? buildLectureQRUrl(tokenOrCode) : '');
    const qrDataUrl = await QRCode.toDataURL(targetUrl || 'https://englizeka.com', {
      width: 240,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    });
    prepared.push({
      id: c.id,
      suffix: c.suffix,
      targetUrl,
      videoTitle: c.videoTitle || 'محاضرة إنجليزيكا',
      courseTitle: c.courseTitle,
      qrDataUrl,
    });
  }
  return prepared;
}

function buildHTML(cards: PreparedQRCard[], fontBase64: string): string {
  const cardsHtml = cards
    .map(
      (c) => `
      <div class="card">
        <div class="brand">منصة إنجليزيكا · ENGLIZEKA</div>
        <div class="title" dir="rtl" lang="ar">${escapeHtml(c.videoTitle)}</div>
        ${c.courseTitle ? `<div class="course" dir="rtl" lang="ar">${escapeHtml(c.courseTitle)}</div>` : ''}
        <div class="qr-container">
          <img src="${c.qrDataUrl}" width="108" height="108" alt="QR Code" />
        </div>
        <div class="instruction" dir="rtl" lang="ar">امسح الرمز بكاميرا هاتفك لفتح المحاضرة مباشرة</div>
        <div class="badge">صالح للاستخدام مرة واحدة فقط لطالب واحد</div>
        <div class="id-ref" dir="ltr">ID: ••••${escapeHtml(c.suffix)}</div>
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
    margin: 15mm 12mm;
  }

  body {
    font-family: 'NotoSansArabic', 'Segoe UI', Tahoma, Arial, sans-serif;
    direction: rtl;
    background: #fff;
    color: #0f172a;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    width: 100%;
  }

  .card {
    border: 1.5px solid #1e293b;
    border-radius: 8px;
    padding: 10px 8px 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    background: #fff;
    page-break-inside: avoid;
    overflow: hidden;
    min-height: 210px;
  }

  .brand {
    font-size: 8.5px;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: #64748b;
    text-transform: uppercase;
    margin-bottom: 3px;
  }

  .title {
    font-family: 'NotoSansArabic', 'Segoe UI', Tahoma, Arial, sans-serif;
    font-size: 11px;
    font-weight: 700;
    color: #0f172a;
    line-height: 1.35;
    margin-bottom: 2px;
    max-width: 95%;
    word-break: break-word;
  }

  .course {
    font-size: 9px;
    font-weight: 600;
    color: #475569;
    margin-bottom: 6px;
    max-width: 95%;
  }

  .qr-container {
    background: #fff;
    padding: 3px;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin: 4px 0;
  }

  .instruction {
    font-size: 9px;
    font-weight: 600;
    color: #0f172a;
    margin-top: 5px;
    line-height: 1.3;
  }

  .badge {
    display: inline-block;
    font-size: 7.5px;
    font-weight: 700;
    color: #b91c1c;
    background: #fef2f2;
    border: 0.5px solid #fecaca;
    border-radius: 9999px;
    padding: 1.5px 8px;
    margin-top: 4px;
  }

  .id-ref {
    font-family: monospace;
    font-size: 8px;
    color: #94a3b8;
    margin-top: 4px;
    direction: ltr;
  }
</style>
</head>
<body>
  <div class="grid">
    ${cardsHtml}
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

  // Pre-generate QR code buffers for PDFKit
  const cardsWithBuffers = await Promise.all(
    codes.map(async (c) => {
      const tokenOrCode = c.token || c.fullCode || '';
      const targetUrl = c.url || (tokenOrCode ? buildLectureQRUrl(tokenOrCode) : '');
      const qrBuffer = await QRCode.toBuffer(targetUrl || 'https://englizeka.com', {
        width: 180,
        margin: 1,
      });
      return {
        ...c,
        qrBuffer,
        videoTitle: c.videoTitle || 'محاضرة إنجليزيكا',
      };
    })
  );

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 30 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const fontPath = getArabicFontPath();
    const hasArabicFont = fs.existsSync(/*turbopackIgnore: true*/ fontPath);
    if (hasArabicFont) {
      doc.registerFont('NotoArabic', fontPath);
    }

    const pageWidth = doc.page.width - 60;
    const colWidth = (pageWidth - 14) / 2;
    const cardHeight = 175;
    const cardsPerPage = Math.floor((doc.page.height - 60) / (cardHeight + 12)) * 2;

    for (let i = 0; i < cardsWithBuffers.length; i++) {
      const indexOnPage = i % cardsPerPage;
      const row = Math.floor(indexOnPage / 2);
      const col = indexOnPage % 2;

      if (i > 0 && indexOnPage === 0) {
        doc.addPage();
      }

      const currentX = 30 + col * (colWidth + 14);
      const currentY = 30 + row * (cardHeight + 12);
      const card = cardsWithBuffers[i];

      // Draw card border
      doc.roundedRect(currentX, currentY, colWidth, cardHeight, 6).lineWidth(1.2).stroke('#1e293b');

      // Brand text
      doc.font('Helvetica-Bold')
        .fontSize(7.5)
        .fillColor('#64748b')
        .text('ENGLIZEKA PLATFORM', currentX + 6, currentY + 8, {
          width: colWidth - 12,
          align: 'center',
          lineBreak: false,
        });

      // Lecture title
      if (hasArabicFont) {
        doc.font('NotoArabic').fontSize(10);
      } else {
        doc.font('Helvetica-Bold').fontSize(10);
      }
      doc.fillColor('#0f172a')
        .text(card.videoTitle, currentX + 6, currentY + 22, {
          width: colWidth - 12,
          align: 'center',
          lineBreak: false,
        });

      // QR Code image
      const qrSize = 85;
      const qrX = currentX + (colWidth - qrSize) / 2;
      const qrY = currentY + 38;
      doc.image(card.qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });

      // Scan instruction
      if (hasArabicFont) {
        doc.font('NotoArabic').fontSize(8);
      } else {
        doc.font('Helvetica').fontSize(8);
      }
      doc.fillColor('#0f172a')
        .text('امسح الرمز بكاميرا هاتفك لفتح المحاضرة', currentX + 6, currentY + 128, {
          width: colWidth - 12,
          align: 'center',
          lineBreak: false,
        });

      // Single-use badge note
      if (hasArabicFont) {
        doc.font('NotoArabic').fontSize(7);
      } else {
        doc.font('Helvetica').fontSize(7);
      }
      doc.fillColor('#b91c1c')
        .text('صالح للاستخدام مرة واحدة لطالب واحد', currentX + 6, currentY + 144, {
          width: colWidth - 12,
          align: 'center',
          lineBreak: false,
        });

      // Card ID reference
      doc.font('Courier')
        .fontSize(7)
        .fillColor('#94a3b8')
        .text(`ID: ...${card.suffix}`, currentX + 6, currentY + 158, {
          width: colWidth - 12,
          align: 'center',
          lineBreak: false,
        });
    }

    doc.end();
  });
}

/**
 * Generate a printable PDF of QR codes.
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
      const cards = await prepareQRCards(codes);
      const html = buildHTML(cards, fontBase64);

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
          margin: { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' },
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

export const generateLectureQRPDF = generateAccessCodePDF;

