export interface PreviewLine {
    text: string;
    align: 'right' | 'center' | 'left';
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    size?: 'small' | 'normal' | 'large';
    style?: string;
    type?: 'text' | 'image';
    fileId?: string;
    imageLines?: number;
    imageMask?: 'square' | 'rounded' | 'circle';
}
export interface DocPreviewOptions {
    templateId: number;
    pageSize: string;
    lines?: PreviewLine[];
    selectedFont?: string;
}
export declare const TEMPLATE_NAMES: Record<number, string>;
export declare function generatePreviewPNG(opts: DocPreviewOptions): Promise<Buffer>;
