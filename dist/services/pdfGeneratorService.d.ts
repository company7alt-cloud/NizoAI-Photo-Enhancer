export declare function getLineCapacity(templateId: number): number;
export interface PdfPageParams {
    type: 'text' | 'image';
    lines?: string[];
    imageBuffer?: Buffer | string;
    overlayText?: string;
    captionText?: string;
}
export interface PdfGeneratorParams {
    pageSize: string | null;
    customSize: {
        width: number;
        height: number;
    } | null;
    templateId?: number | null;
    pages: PdfPageParams[];
}
export interface RichLine {
    text: string;
    align: 'right' | 'center' | 'left';
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    size?: 'small' | 'normal' | 'large';
    style?: 'normal' | 'quote' | 'divider' | 'highlight';
    letterSpacing?: number;
    lineSpacing?: number;
}
export declare function generateDocument(params: PdfGeneratorParams): Promise<Buffer>;
export interface AlignedLine {
    text: string;
    align: 'right' | 'center' | 'left';
}
export declare function generateDocumentFromLines(lines: (RichLine | AlignedLine)[], pageSize?: string, selectedFont?: string, docBgColor?: string, docTextColor?: string): Promise<{
    buffer: Buffer;
    pageCount: number;
}>;
