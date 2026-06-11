// src/utils/adminTextState.ts
// ─── imageBot Admin Text-Override State ───────────────────────────────────────

export type ImageAdminTextState =
  | 'awaiting_old_text'
  | 'awaiting_new_text';

const imageAdminTextState = new Map<number, {
  state: ImageAdminTextState;
  oldText?: string;
  updatedAt: number;
}>();

const IMAGE_ADMIN_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function setImageAdminState(userId: number, state: ImageAdminTextState, oldText?: string): void {
  imageAdminTextState.set(userId, { state, oldText, updatedAt: Date.now() });
}

export function getImageAdminState(userId: number): { state: ImageAdminTextState; oldText?: string } | undefined {
  const entry = imageAdminTextState.get(userId);
  if (!entry) return undefined;
  if (Date.now() - entry.updatedAt > IMAGE_ADMIN_STATE_TTL_MS) {
    imageAdminTextState.delete(userId);
    return undefined;
  }
  return entry;
}

export function clearImageAdminState(userId: number): void {
  imageAdminTextState.delete(userId);
}
