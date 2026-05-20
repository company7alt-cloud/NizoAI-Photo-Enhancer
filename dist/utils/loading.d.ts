import { BotContext } from './validators';
export declare function showDynamicLoading(ctx: BotContext, baseText: string): Promise<{
    stop: () => Promise<void>;
}>;
