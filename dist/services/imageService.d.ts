export declare function enhance(telegramFileUrl: string, resolution: '2K' | '4K' | '8K'): Promise<Buffer>;
export declare function enhanceWithNanoBanana(base64Image: string, aiPrompt: string): Promise<Buffer>;
export declare function process4KAi(imageUrl: string): Promise<Buffer>;
export declare function processProEnhance(imageUrl: string, quality: string, scale: number, imageType: string): Promise<Buffer>;
export declare function processNanoBanana(imageUrl: string): Promise<Buffer>;
export declare function processWatermarkEraser(imageUrl: string): Promise<Buffer>;
export declare function convertImageFormat(buffer: Buffer, format: 'jpg' | 'png' | 'webp' | 'gif' | 'tiff'): Promise<{
    buffer: Buffer;
    mimeType: string;
    ext: string;
}>;
