import { IBotText } from '../database/models/BotTexts';
export declare const DEFAULT_TEXTS: Record<string, {
    category: 'message' | 'button' | 'notification';
    value: string;
    description: string;
}>;
export declare function initBotTexts(): Promise<void>;
export declare function getText(key: string): Promise<string>;
export declare function parsePlaceholders(text: string, vars: Record<string, string>): string;
export declare function updateText(key: string, newValue: string): Promise<boolean>;
export declare function resetText(key: string): Promise<string | null>;
export declare function searchByContent(query: string): Promise<IBotText[]>;
export declare function getByCategory(category: 'message' | 'button' | 'notification'): Promise<IBotText[]>;
