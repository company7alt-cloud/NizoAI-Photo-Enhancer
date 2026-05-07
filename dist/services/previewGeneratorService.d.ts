export interface PreviewLine {
    text: string;
    align: 'right' | 'center' | 'left';
}
export interface DocPreviewOptions {
    templateId: number;
    pageSize: string;
    lines?: PreviewLine[];
}
export declare const TEMPLATE_NAMES: Record<number, string>;
export declare function generatePreviewPNG(opts: DocPreviewOptions): Promise<Buffer>;
