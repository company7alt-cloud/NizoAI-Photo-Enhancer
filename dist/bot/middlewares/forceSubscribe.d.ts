import { NextFunction } from 'grammy';
import { BotContext } from '../../utils/validators';
export declare function forceSubscribeMiddleware(ctx: BotContext, next: NextFunction): Promise<void>;
