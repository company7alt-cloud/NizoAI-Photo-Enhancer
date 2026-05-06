import mongoose from 'mongoose';
const globalStatSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  count: { type: Number, default: 5000 }
});
export const GlobalStat = mongoose.models.GlobalStat || mongoose.model('GlobalStat', globalStatSchema);
