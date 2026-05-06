import { Context, SessionFlavor, InlineKeyboard } from 'grammy';
import { IUser } from '../database/models/User';
import { Resolution } from '../services/queueService';
export interface DocLine {
    text: string;
    align: 'right' | 'center' | 'left';
}
export interface SessionData {
    pendingFile?: {
        fileId: string;
        fileName: string;
    };
    pendingConversionFileId?: string;
    pendingConversionFormat?: string;
    pendingBatchFiles?: string[];
    isInDocMaker?: boolean;
    tempLine?: string | null;
    documentLines?: DocLine[];
}
export type BotContext = Context & SessionFlavor<SessionData>;
export declare function validateEnv(): void;
export declare function isFileSizeValid(bytes: number): boolean;
export declare function getAdminIds(): number[];
export declare function isAdmin(id: number): boolean;
export declare function parseStartPayload(payload?: string): number | null;
export declare function checkAndDeductQuota(u: IUser): {
    canProceed: boolean;
};
export declare const sleep: (ms: number) => Promise<void>;
export declare function buildResolutionKeyboard(): InlineKeyboard;
export declare function buildPostEnhanceKeyboard(): InlineKeyboard;
export declare function buildAdminMainKeyboard(active: boolean): InlineKeyboard;
export declare function buildAdminBackKeyboard(): InlineKeyboard;
export declare function buildAdminSettingsKeyboard(notifyOn: boolean, autoDeleteOn: boolean, maintenanceOn: boolean): InlineKeyboard;
export declare function buildUserActionKeyboard(tid: number, banned: boolean): InlineKeyboard;
export declare function resolutionLabel(res: Resolution): string;
