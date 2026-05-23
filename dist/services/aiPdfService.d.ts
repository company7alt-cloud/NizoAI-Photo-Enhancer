export declare function generateAiPDF(rawMarkdown: string, template?: string): Promise<string>;
export interface ProImagePageData {
    page: number;
    photos: string[];
    caption?: string;
}
export declare function generateProImagePDF(opts: {
    topic: string;
    images: ProImagePageData[];
    botToken: string;
    template?: string;
}): Promise<string>;
