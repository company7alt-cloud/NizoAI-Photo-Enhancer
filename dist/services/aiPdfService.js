"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAiPDF = generateAiPDF;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PdfPrinter = require('pdfmake/build/pdfmake.js');
const vfsFonts = require('pdfmake/build/vfs_fonts');
const fonts = {
    Roboto: {
        normal: Buffer.from(vfsFonts.pdfMake.vfs['Roboto-Regular.ttf'], 'base64'),
        bold: Buffer.from(vfsFonts.pdfMake.vfs['Roboto-Medium.ttf'], 'base64'),
        italics: Buffer.from(vfsFonts.pdfMake.vfs['Roboto-Italic.ttf'], 'base64'),
        bolditalics: Buffer.from(vfsFonts.pdfMake.vfs['Roboto-MediumItalic.ttf'], 'base64'),
    }
};
function markdownToContent(markdown) {
    const content = [];
    const lines = markdown.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            content.push({ text: ' ', margin: [0, 4] });
            continue;
        }
        if (trimmed.startsWith('### ')) {
            content.push({ text: trimmed.slice(4).replace(/\*\*(.*?)\*\*/g, '$1'), style: 'h3', alignment: 'right', margin: [0, 8, 0, 4] });
        }
        else if (trimmed.startsWith('## ')) {
            content.push({ text: trimmed.slice(3).replace(/\*\*(.*?)\*\*/g, '$1'), style: 'h2', alignment: 'right', margin: [0, 10, 0, 5] });
        }
        else if (trimmed.startsWith('# ')) {
            content.push({ text: trimmed.slice(2).replace(/\*\*(.*?)\*\*/g, '$1'), style: 'h1', alignment: 'right', margin: [0, 12, 0, 8] });
        }
        else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            const itemText = trimmed.slice(2).replace(/\*\*(.*?)\*\*/g, '$1').replace(/<[^>]+>/g, '');
            content.push({ text: '• ' + itemText, alignment: 'right', margin: [0, 2, 15, 2], fontSize: 12 });
        }
        else if (trimmed.match(/^\|.+\|$/)) {
            // skip table rows — handled separately
        }
        else if (trimmed.match(/^\|[-:| ]+\|$/)) {
            // skip separator
        }
        else {
            const cleanText = trimmed.replace(/\*\*(.*?)\*\*/g, '$1').replace(/<[^>]+>/g, '');
            if (cleanText)
                content.push({ text: cleanText, alignment: 'right', fontSize: 12, margin: [0, 3] });
        }
    }
    // Parse tables
    const tableRegex = /(\|.+\|\n?)+/g;
    const fullText = markdown;
    const tableMatches = fullText.match(tableRegex);
    if (tableMatches) {
        for (const tableStr of tableMatches) {
            const rows = tableStr.trim().split('\n')
                .filter(r => !r.match(/^\|[-:| ]+\|$/))
                .map(row => row.split('|').filter(cell => cell.trim() !== '').map(cell => ({
                text: cell.trim().replace(/<[^>]+>/g, '').replace(/\*\*(.*?)\*\*/g, '$1'),
                alignment: 'right',
                fontSize: 10,
                margin: [4, 4, 4, 4]
            })));
            if (rows.length > 0 && rows[0].length > 0) {
                const tableContent = {
                    table: {
                        headerRows: 1,
                        widths: Array(rows[0].length).fill('*'),
                        body: rows
                    },
                    layout: 'lightHorizontalLines',
                    margin: [0, 10, 0, 10]
                };
                content.push(tableContent);
            }
        }
    }
    return content;
}
async function generateAiPDF(markdownText) {
    const cleaned = markdownText
        .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}]/gu, '')
        .trim();
    const printer = new PdfPrinter(fonts);
    const docDefinition = {
        content: markdownToContent(cleaned),
        defaultStyle: {
            font: 'Roboto',
            fontSize: 12,
            lineHeight: 1.6,
        },
        styles: {
            h1: { fontSize: 20, bold: true, color: '#1a1a2e' },
            h2: { fontSize: 16, bold: true, color: '#1a1a2e' },
            h3: { fontSize: 14, bold: true, color: '#333333' },
        },
        pageMargins: [40, 60, 40, 60],
        pageSize: 'A4',
    };
    return new Promise((resolve, reject) => {
        try {
            const pdfDoc = printer.createPdfKitDocument(docDefinition);
            const chunks = [];
            pdfDoc.on('data', (chunk) => chunks.push(chunk));
            pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
            pdfDoc.on('error', reject);
            pdfDoc.end();
        }
        catch (err) {
            reject(err);
        }
    });
}
//# sourceMappingURL=aiPdfService.js.map