import PDFDocument from 'pdfkit';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const arabicReshaper = require('arabic-reshaper');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bidiFactory = require('bidi-js');

const bidiEngine = bidiFactory();

function prepareText(text: string): string {
  if (!text) return '';
  const hasArabic = /[\u0600-\u06FF]/.test(text);
  if (!hasArabic) return text;
  try {
    const reshaped: string = arabicReshaper.convertArabic(text);
    return bidiEngine.getReorderedString(reshaped, { dir: 'rtl' });
  } catch {
    return text;
  }
}

export async function generateAiPDF(markdownText: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        autoFirstPage: true,
        size: 'A4',
        margin: 50,
        info: { Title: 'NizoAI Document' }
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const lines = markdownText.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed) {
          doc.moveDown(0.5);
          continue;
        }

        // H3
        if (trimmed.startsWith('### ')) {
          const text = prepareText(trimmed.slice(4).replace(/\*\*/g, ''));
          const isArabic = /[\u0600-\u06FF]/.test(trimmed);
          doc.fontSize(14).font('Helvetica-Bold')
            .text(text, { align: isArabic ? 'right' : 'left' });
          doc.moveDown(0.3);

        // H2
        } else if (trimmed.startsWith('## ')) {
          const text = prepareText(trimmed.slice(3).replace(/\*\*/g, ''));
          const isArabic = /[\u0600-\u06FF]/.test(trimmed);
          doc.fontSize(16).font('Helvetica-Bold')
            .text(text, { align: isArabic ? 'right' : 'left' });
          doc.moveDown(0.4);

        // H1
        } else if (trimmed.startsWith('# ')) {
          const text = prepareText(trimmed.slice(2).replace(/\*\*/g, ''));
          const isArabic = /[\u0600-\u06FF]/.test(trimmed);
          doc.fontSize(20).font('Helvetica-Bold')
            .fillColor('#1a1a2e')
            .text(text, { align: isArabic ? 'right' : 'left' });
          doc.moveDown(0.5).fillColor('black');

        // List items
        } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          const itemText = trimmed.slice(2)
            .replace(/\*\*(.*?)\*\*/g, '$1')
            .replace(/<[^>]+>/g, '');
          const prepared = prepareText(itemText);
          const isArabic = /[\u0600-\u06FF]/.test(itemText);
          doc.fontSize(12).font('Helvetica')
            .text((isArabic ? '' : '• ') + prepared + (isArabic ? ' •' : ''), {
              align: isArabic ? 'right' : 'left',
              indent: isArabic ? 0 : 15
            });

        // Table separator
        } else if (trimmed.match(/^\|[-:| ]+\|$/)) {
          doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#cccccc').moveDown(0.2);

        // Table row
        } else if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
          const cells = trimmed.split('|')
            .filter(c => c.trim())
            .map(c => c.trim().replace(/<[^>]+>/g, ''));
          const rowText = cells.map(c => prepareText(c)).join('  |  ');
          const isArabic = /[\u0600-\u06FF]/.test(rowText);
          doc.fontSize(11).font('Helvetica')
            .text(rowText, { align: isArabic ? 'right' : 'left' });

        // Normal paragraph
        } else {
          const cleanText = trimmed
            .replace(/\*\*(.*?)\*\*/g, '$1')
            .replace(/<[^>]+>/g, '');
          if (!cleanText) continue;
          const prepared = prepareText(cleanText);
          const isArabic = /[\u0600-\u06FF]/.test(cleanText);
          doc.fontSize(12).font('Helvetica')
            .text(prepared, { align: isArabic ? 'right' : 'left', lineGap: 4 });
        }
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
