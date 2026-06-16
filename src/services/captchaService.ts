export const captchaStore = new Map<number, { correctIndex: number; attempts: number }>();

const EMOJI_POOL = [
  '🍎','🚗','⚽','🎸','🐼','🍕','🚀','⭐','🎈','🎲',
  '🍔','🌻','🐶','👑','⏰','🔥','💎','🎯','🦁','🌈',
  '🎃','🍦','🎹','🦋','🐬','🍓','🎪','🦄','🏆','🌙',
];

export function generateCaptcha(userId: number): { targetEmoji: string; keyboard: { text: string; callback_data: string }[][] } {
  const pool = [...EMOJI_POOL].sort(() => Math.random() - 0.5);
  const chosen = pool.slice(0, 4);
  const correctIndex = Math.floor(Math.random() * 4);

  captchaStore.set(userId, { correctIndex, attempts: 0 });

  const keyboard: { text: string; callback_data: string }[][] = [
    [
      { text: chosen[0], callback_data: 'captcha_0' },
      { text: chosen[1], callback_data: 'captcha_1' },
    ],
    [
      { text: chosen[2], callback_data: 'captcha_2' },
      { text: chosen[3], callback_data: 'captcha_3' },
    ],
    [
      { text: '🔄 تغيير التحقق', callback_data: 'captcha_refresh' },
    ],
  ];

  return { targetEmoji: chosen[correctIndex], keyboard };
}
