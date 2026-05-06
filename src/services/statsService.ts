import { GlobalStat } from '../database/models/GlobalStat';

export async function incrementGlobalCounter(): Promise<void> {
  try {
    await GlobalStat.findOneAndUpdate(
      { key: 'total_processed' },
      { $inc: { count: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    console.error('[StatsService] Increment error:', error);
  }
}

export async function getGlobalCounter(): Promise<number> {
  try {
    const stat = await GlobalStat.findOne({ key: 'total_processed' });
    return stat ? stat.count : 5000;
  } catch {
    return 5000;
  }
}
