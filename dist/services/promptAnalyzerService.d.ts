export type DocumentType = 'medical_academic' | 'financial_business' | 'legal' | 'general';
export interface PromptAnalysisResult {
    enhancedPrompt: string;
    detectedPages: number;
    documentType: DocumentType;
    needsTables: boolean;
    hasExplicitPageRequest: boolean;
}
export declare function analyzeAndEnhancePrompt(userRawPrompt: string): PromptAnalysisResult;
export declare function buildPageLimitGuardMessage(pageLimit: number): string;
