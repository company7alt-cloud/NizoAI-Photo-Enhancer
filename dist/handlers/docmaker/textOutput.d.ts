import { BotContext } from '../../utils/validators';
export declare function splitSafe(text: string, limit?: number): string[];
export declare function sendTextChunksWithEditButton(ctx: BotContext, generatedText: string): Promise<void>;
