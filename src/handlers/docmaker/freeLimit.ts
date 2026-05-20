import { IUser, User } from '../../database/models/User';

export async function checkAndResetDailyFree(user: IUser): Promise<void> {
  const today = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'
  if (user.freePdfsLastResetDate !== today) {
    await User.updateOne(
      { _id: user._id },
      { $set: { freePdfsGeneratedToday: 0, freePdfsLastResetDate: today } }
    );
    user.freePdfsGeneratedToday = 0;
    user.freePdfsLastResetDate = today;
  }
}
