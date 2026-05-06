"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateDocument = generateDocument;
// src/services/pdfGeneratorService.ts
const pdfkit_1 = __importDefault(require("pdfkit"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const arabic_reshaper_1 = __importDefault(require("arabic-reshaper"));
const bidi_js_1 = __importDefault(require("bidi-js"));
// Arabic reshaper configuration
const bidiEngine = (0, bidi_js_1.default)();
const bidiOptions = { dir: 'rtl' };
/**
 * Reorders and reshapes Arabic text for pdfkit
 */
function prepareArabicText(text) {
    // 1. Reshape the text so characters join correctly
    const reshaped = arabic_reshaper_1.default.reshape(text);
    // 2. Reorder for RTL rendering (bidi-js)
    const bidiResult = bidiEngine.getReorderedString(reshaped, bidiOptions);
    return bidiResult;
}
async function generateDocument(params) {
    return new Promise((resolve, reject) => {
        try {
            const docOptions = {
                autoFirstPage: false,
                size: params.pageSize ? params.pageSize : undefined,
            };
            if (params.customSize && params.customSize.width && params.customSize.height) {
                docOptions.size = [params.customSize.width, params.customSize.height];
            }
            const doc = new pdfkit_1.default(docOptions);
            // We need an Arabic font. Assuming it's in assets/fonts/Amiri-Regular.ttf
            // If it doesn't exist, we will gracefully fallback to standard font, though Arabic will render badly.
            const fontPath = path_1.default.join(process.cwd(), 'assets', 'fonts', 'Amiri-Regular.ttf');
            if (fs_1.default.existsSync(fontPath)) {
                doc.registerFont('Arabic', fontPath);
                doc.font('Arabic');
            }
            const buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => resolve(Buffer.concat(buffers)));
            for (const page of params.pages) {
                doc.addPage();
                if (page.type === 'text' && page.lines) {
                    doc.fontSize(16);
                    for (const line of page.lines) {
                        const processedLine = prepareArabicText(line);
                        // align right for Arabic
                        doc.text(processedLine, { align: 'right' });
                        doc.moveDown(0.5);
                    }
                }
                else if (page.type === 'image' && page.imageBuffer) {
                    const imgBuf = typeof page.imageBuffer === 'string'
                        ? Buffer.from(page.imageBuffer, 'base64')
                        : page.imageBuffer;
                    // Add image covering width with margin
                    doc.image(imgBuf, 50, 50, { fit: [doc.page.width - 100, doc.page.height - 200], align: 'center', valign: 'center' });
                    if (page.overlayText) {
                        doc.fontSize(24).fillColor('red');
                        const processedOverlay = prepareArabicText(page.overlayText);
                        doc.text(processedOverlay, 50, doc.page.height / 2, { align: 'center' });
                    }
                    if (page.captionText) {
                        doc.fontSize(14).fillColor('black');
                        const processedCaption = prepareArabicText(page.captionText);
                        doc.text(processedCaption, 50, doc.page.height - 100, { align: 'center' });
                    }
                }
            }
            doc.end();
        }
        catch (err) {
            reject(err);
        }
    });
}
//# sourceMappingURL=pdfGeneratorService.js.map