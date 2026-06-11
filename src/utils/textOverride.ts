import { TextOverride } from '../database/models/TextOverride';

// In-memory cache: originalText → newText
const overrideCache = new Map<string, string>();
let cacheLoaded = false;

export async function loadOverrideCache(): Promise<void> {
  const all = await TextOverride.find({}).lean();
  overrideCache.clear();
  for (const entry of all) {
    overrideCache.set(entry.originalText, entry.newText);
  }
  cacheLoaded = true;
}

export async function replaceText(text: string): Promise<string> {
  if (!cacheLoaded) await loadOverrideCache();
  return overrideCache.get(text) ?? text;
}

export async function saveOverride(originalText: string, newText: string, adminId: number): Promise<void> {
  await TextOverride.findOneAndUpdate(
    { originalText },
    { newText, updatedBy: adminId, updatedAt: new Date() },
    { upsert: true, new: true }
  );
  overrideCache.set(originalText, newText);
}

export async function deleteOverride(originalText: string): Promise<void> {
  await TextOverride.deleteOne({ originalText });
  overrideCache.delete(originalText);
}

export async function getAllOverrides(): Promise<Array<{ originalText: string; newText: string }>> {
  return TextOverride.find({}).select('originalText newText -_id').lean();
}
