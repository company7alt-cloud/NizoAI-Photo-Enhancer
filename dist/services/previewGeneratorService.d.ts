export interface PreviewLine {
    text: string;
    align: 'right' | 'center' | 'left';
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    size?: 'small' | 'normal' | 'large';
    style?: string;
    type?: 'text' | 'image' | 'image_row';
    fileId?: string;
    imageLines?: number;
    imageMask?: 'square' | 'rounded' | 'circle';
    rowImages?: Array<{
        fileId: string;
        lines: number;
        align: 'right' | 'center' | 'left';
        mask: 'square' | 'rounded' | 'circle';
        caption?: string;
    }>;
}
export interface DocPreviewOptions {
    templateId: number;
    pageSize: string;
    lines?: PreviewLine[];
    selectedFont?: string;
    docBgColor?: string;
    docTextColor?: string;
}
export declare const TEMPLATE_NAMES: Record<number, string>;
export declare function generatePreviewPNG(opts: DocPreviewOptions): Promise<Buffer>;
