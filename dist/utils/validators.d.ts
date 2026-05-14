import { Context, SessionFlavor, InlineKeyboard } from 'grammy';
import { IUser } from '../database/models/User';
import { Resolution } from '../services/queueService';
export interface DocLine {
    text: string;
    align: 'right' | 'center' | 'left';
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    size?: 'small' | 'normal' | 'large';
    style?: 'normal' | 'quote' | 'divider' | 'highlight';
    color?: string;
    letterSpacing?: number;
    lineSpacing?: number;
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
export interface SessionData {
    pendingFile?: {
        fileId: string;
        fileName: string;
    };
    pendingConversionFileId?: string;
    pendingConversionFormat?: string;
    pendingBatchFiles?: string[];
    isInDocMaker?: boolean;
    docType?: string;
    templateId?: number;
    pageSize?: string;
    tempLine?: string | null;
    tempFormatting?: {
        bold: boolean;
        italic: boolean;
        underline: boolean;
        size: 'small' | 'normal' | 'large';
        style: 'normal' | 'quote' | 'divider' | 'highlight';
        color?: string;
        align?: 'right' | 'center' | 'left';
        letterSpacing?: number;
        lineSpacing?: number;
    } | null;
    documentLines?: DocLine[];
    pendingExportCost?: number;
    pendingExportPages?: number;
    editingLineIndex?: number;
    awaitingLineEditIndex?: boolean;
    awaitingLineEditText?: boolean;
    previewMessageId?: number;
    awaitingCustomWidth?: boolean;
    awaitingCustomHeight?: boolean;
    customSizeWidth?: number;
    customSizeDims?: {
        width: number;
        height: number;
        label: string;
    };
    selectedFont?: string;
    docBgColor?: string;
    docTextColor?: string;
    docState?: 'active' | 'awaiting_custom_img_lines' | 'awaiting_row_caption' | null;
    tempImage?: {
        fileId: string;
        lines?: number;
        align?: 'right' | 'center' | 'left';
        mask?: 'square' | 'rounded' | 'circle';
        caption?: string;
    };
    rowImages?: Array<{
        fileId: string;
        lines: number;
        align: 'right' | 'center' | 'left';
        mask: 'square' | 'rounded' | 'circle';
        caption?: string;
    }>;
    awaitingRowCaption?: number;
    tempCaptionTarget?: number | 'temp';
    awaitingNextRowImage?: boolean;
    awaitingCustomColor?: boolean;
    customColorPromptId?: number;
    awaitingTypographyValue?: 'letter' | 'line';
    typographyPromptId?: number;
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
