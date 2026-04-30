import { LockSettings, ILockSettings } from '../database/models/LockSettings';

export async function getSettings(): Promise<ILockSettings> {
  let settings = await LockSettings.findOne();
  if (!settings) {
    settings = await LockSettings.create({});
  }
  return settings;
}

export async function toggleLock(field: string): Promise<ILockSettings> {
  const settings = await getSettings();
  const currentValue = (settings.locks as any)[field];
  await LockSettings.findOneAndUpdate(
    {},
    { $set: { [`locks.${field}`]: !currentValue } },
    { upsert: true }
  );
  return await getSettings();
}
