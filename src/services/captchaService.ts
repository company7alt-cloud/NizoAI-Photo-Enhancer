export const captchaStore = new Map<number, { correctIndex: number; attempts: number }>();
export const captchaBanStore = new Map<number, number>();

const EMOJI_POOL = [
  '🍎','🚗','⚽','🎸','🐼','🍕','🚀','⭐','🎈','🎲',
  '🍔','🌻','🐶','👑','⏰','🔥','💎','🎯','🦁','🌈',
  '🎃','🍦','🎹','🦋','🐬','🍓','🎪','🦄','🏆','🌙',
];

export function generateCaptcha(userId: number): { targetEmoji: string; keyboard: any[][] } {
  const pool = [...EMOJI_POOL].sort(() => Math.random() - 0.5);
  const chosen = pool.slice(0, 4);
  const correctIndex = Math.floor(Math.random() * 4);
  captchaStore.set(userId, { correctIndex, attempts: 0 });
  const keyboard: any[][] = [
    [
      { text: chosen[0], callback_data: 'captcha_0', style: 'primary' },
      { text: chosen[1], callback_data: 'captcha_1', style: 'primary' },
    ],
    [
      { text: chosen[2], callback_data: 'captcha_2', style: 'primary' },
      { text: chosen[3], callback_data: 'captcha_3', style: 'primary' },
    ],
    [
      { text: '🔄 تغيير التحقق', callback_data: 'captcha_refresh', style: 'success' },
    ],
  ];
  return { targetEmoji: chosen[correctIndex], keyboard };
}
