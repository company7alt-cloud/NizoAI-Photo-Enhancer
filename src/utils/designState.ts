// src/utils/designState.ts

export interface DesignState {
  originalFileId: string;
  originalBuffer?: Buffer;        // MUST be cleared in clearDesignState
  gridSize: number;
  cols: number;
  rows: number;
  contentType: 'text' | 'image' | null;
  contentValue: string;           // text string OR base64 of overlay image
  selectedCells: number[];
  selectedFont: string;           // e.g. 'Almarai', 'Cormorant'
  selectedWeight: string;         // e.g. 'Light', 'Regular', 'Bold', 'Black'
  fontWeight?: string;
  textColor: string;              // hex e.g. '#FFFFFF'
  textOpacity?: number; // 10 | 20 | 40 | 60 | 80 | 100
  nudgeSpeed?: number; // 1 | 2 | 4 (legacy, kept for safety)
  nudgeSpeedPct?: number; // 0.5 | 1 | 2 | 4 | 8
  offsetX?: number;
  offsetY?: number;
  scaleMultiplier?: number;
  // ── Text Shadow ──────────────────────────────────
  shadowEnabled?: boolean;
  shadowType?: 'drop' | 'glow' | 'inner';
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowBlur?: number;
  shadowSpeed?: 'normal' | 'fast';
  imageEffects: {
    grayscale: boolean;
    saturate: boolean;
    invert: boolean;
    upscale: boolean;
  };
  previewMsgId?: number;
  gridMsgId?: number;
  colorMsgId?: number;
  stepMsgId?: number;
  lastActivity: number;           // Date.now()
}

const designStates = new Map<number, DesignState>();

export function setDesignState(userId: number, state: DesignState): void {
  designStates.set(userId, state);
}

export function getDesignState(userId: number): DesignState | undefined {
  return designStates.get(userId);
}

export function clearDesignState(userId: number): void {
  const state = designStates.get(userId);
  if (state) {
    // CRITICAL: Force Node.js GC immediately — prevent RAM leak
    state.originalBuffer = undefined;
    state.contentValue = '';
  }
  designStates.delete(userId);
}

// TTL cleanup — runs every 15 minutes
setInterval(() => {
  const now = Date.now();
  const TTL = 15 * 60 * 1000;
  for (const [userId, state] of designStates.entries()) {
    if (now - state.lastActivity > TTL) {
      state.originalBuffer = undefined;
      state.contentValue = '';
      designStates.delete(userId);
    }
  }
}, 15 * 60 * 1000);
