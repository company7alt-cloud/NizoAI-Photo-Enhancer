import { LockSettings, ILockSettings } from '../database/models/LockSettings';

let settingsCache: ILockSettings | null = null;
let settingsCacheTime = 0;
const CACHE_TTL = 30 * 1000; // 30 seconds

export async function getSettings(): Promise<ILockSettings> {
  const now = Date.now();
  if (settingsCache && (now - settingsCacheTime) < CACHE_TTL) {
    return settingsCache;
  }

  let settings = await LockSettings.findOne();
  if (!settings) {
    settings = await LockSettings.create({});
  }

  settingsCache = settings;
  settingsCacheTime = now;
  return settingsCache;
}

export function invalidateSettingsCache() {
  settingsCache = null;
  settingsCacheTime = 0;
}

export async function toggleLock(field: string): Promise<ILockSettings> {
  const settings = await getSettings();
  const currentValue = (settings.locks as any)[field];
  await LockSettings.findOneAndUpdate(
    {},
    { $set: { [`locks.${field}`]: !currentValue } },
    { upsert: true }
  );
  invalidateSettingsCache();
  return await getSettings();
}
