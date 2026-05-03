import { ILockSettings } from '../database/models/LockSettings';
export declare function getSettings(): Promise<ILockSettings>;
export declare function toggleLock(field: string): Promise<ILockSettings>;
