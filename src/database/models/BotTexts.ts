// src/database/models/BotTexts.ts
import mongoose, { Document, Schema } from 'mongoose'

export interface IBotText extends Document {
  key: string
  category: 'message' | 'button' | 'notification'
  value: string
  defaultValue: string
  description: string
}

const BotTextSchema = new Schema<IBotText>({
  key:          { type: String, required: true, unique: true },
  category:     { type: String, enum: ['message','button','notification'], required: true },
  value:        { type: String, required: true },
  defaultValue: { type: String, required: true },
  description:  { type: String, required: true },
}, { timestamps: true })

export const BotText = mongoose.model<IBotText>('BotText', BotTextSchema)
