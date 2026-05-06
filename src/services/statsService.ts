import { GlobalStat } from '../database/models/GlobalStat';

export async function incrementGlobalCounter(): Promise<void> {
  try {
    const stat = await GlobalStat.findOne({ key: 'total_processed' });
    if (!stat) {
      await GlobalStat.create({ key: 'total_processed', count: 5001 });
    } else {
      // If due to a previous bug the count is less than 5000, fix it immediately
      if (stat.count < 5000) {
        stat.count = 5000 + stat.count + 1;
        await stat.save();
      } else {
        await GlobalStat.updateOne({ key: 'total_processed' }, { $inc: { count: 1 } });
      }
    }
  } catch (error) {
    console.error('[StatsService] Increment error:', error);
  }
}

export async function getGlobalCounter(): Promise<number> {
  try {
    const stat = await GlobalStat.findOne({ key: 'total_processed' });
    if (!stat) return 5000;
    if (stat.count < 5000) {
      stat.count = 5000 + stat.count;
      await stat.save();
    }
    return stat.count;
  } catch {
    return 5000;
  }
}
