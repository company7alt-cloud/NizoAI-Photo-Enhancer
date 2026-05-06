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
    pages: PdfPageParams[];
}
export declare function generateDocument(params: PdfGeneratorParams): Promise<Buffer>;
