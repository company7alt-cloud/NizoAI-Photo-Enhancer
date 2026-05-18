"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAiPDF = generateAiPDF;
// src/services/aiPdfService.ts
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PdfPrinter = require('pdfmake/build/pdf.js');
const fonts = {
    Roboto: {
        normal: 'node_modules/pdfmake/build/vfs_fonts.js',
        bold: 'node_modules/pdfmake/build/vfs_fonts.js',
        italics: 'node_modules/pdfmake/build/vfs_fonts.js',
        bolditalics: 'node_modules/pdfmake/build/vfs_fonts.js',
    }
};
function markdownToContent(markdown) {
    const content = [];
    const lines = markdown.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            content.push({ text: ' ', margin: [0, 3] });
            continue;
        }
        // Headers
        if (trimmed.startsWith('### ')) {
            content.push({ text: trimmed.slice(4), style: 'h3', alignment: 'right', margin: [0, 8, 0, 4] });
        }
        else if (trimmed.startsWith('## ')) {
            content.push({ text: trimmed.slice(3), style: 'h2', alignment: 'right', margin: [0, 10, 0, 5] });
        }
        else if (trimmed.startsWith('# ')) {
            content.push({ text: trimmed.slice(2), style: 'h1', alignment: 'right', margin: [0, 12, 0, 6] });
        }
        // Table rows — skip markdown table syntax
        else if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
            // Handle tables separately below
            continue;
        }
        // List items
        else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            const itemText = trimmed.slice(2).replace(/\*\*(.*?)\*\*/g, '$1').replace(/<[^>]+>/g, '');
            content.push({ text: '• ' + itemText, alignment: 'right', margin: [0, 2, 15, 2], style: 'body' });
        }
        // Bold
        else if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
            content.push({ text: trimmed.slice(2, -2), bold: true, alignment: 'right', style: 'body' });
        }
        // Normal paragraph
        else {
            const cleanText = trimmed.replace(/\*\*(.*?)\*\*/g, '$1').replace(/<[^>]+>/g, '');
            content.push({ text: cleanText, alignment: 'right', style: 'body', margin: [0, 3] });
        }
    }
    // Parse tables from markdown
    const tableRegex = /(\|.+\|\n)+/g;
    const tableMatches = markdown.match(tableRegex);
    if (tableMatches) {
        for (const tableStr of tableMatches) {
            const rows = tableStr.trim().split('\n').filter(r => !r.match(/^\|[-:| ]+\|$/));
            const tableBody = rows.map(row => row.split('|').filter(cell => cell.trim() !== '').map(cell => ({
                text: cell.trim().replace(/<[^>]+>/g, ''),
                alignment: 'right',
                fontSize: 11,
                margin: [4, 4]
            })));
            if (tableBody.length > 0) {
                content.push({
                    table: {
                        headerRows: 1,
                        widths: Array(tableBody[0]?.length || 3).fill('*'),
                        body: tableBody
                    },
                    layout: {
                        fillColor: (rowIndex) => rowIndex === 0 ? '#1a1a2e' : (rowIndex % 2 === 0 ? '#f5f5f5' : null),
                    },
                    margin: [0, 10]
                });
            }
        }
    }
    return content;
}
async function generateAiPDF(markdownText) {
    const cleaned = markdownText
        .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}]/gu, '')
        .trim();
    // PdfPrinter is a CJS class — instantiate directly
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
            body: { fontSize: 12, color: '#1a1a1a' },
            tableHeader: { bold: true, color: 'white', fillColor: '#1a1a2e' }
        },
        pageMargins: [40, 60, 40, 60],
        pageSize: 'A4',
    };
    return new Promise((resolve, reject) => {
        const pdfDoc = printer.createPdfKitDocument(docDefinition);
        const chunks = [];
        pdfDoc.on('data', (chunk) => chunks.push(chunk));
        pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
        pdfDoc.on('error', reject);
        pdfDoc.end();
    });
}
//# sourceMappingURL=aiPdfService.js.map