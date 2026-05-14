import { BotContext } from '../../utils/validators';
export declare function smartWrap(text: string, pageSize: string): string[];
export declare function renderActiveSession(ctx: any): Promise<void>;
export declare function handleDocMakerCallback(ctx: BotContext): Promise<boolean>;
export declare function handleDocMakerMessage(ctx: BotContext): Promise<boolean>;
export declare function showImageFormatMenu(ctx: any): Promise<void>;
