const fs = require('fs');

function fix() {
  // ── 1. imageHandler.ts (Image Guard & Resolution Menu) ──
  let imgTs = fs.readFileSync('src/bot/handlers/imageHandler.ts', 'utf8');

  // Guard replacement
  const guardRegex = /\/\/ ── Image Upload Guard ──[\s\S]*?\/\/ ── End Guard ──[^\n]*\n/m;
  const newGuard = `  // ── Strict Image Upload Guard ──
  const isAwaitingImage = (
    ctx.session?.workflowState === 'awaiting_image' ||
    ctx.session?.isAwaitingImage === true ||
    ctx.session?.currentService != null
  );

  if (!isAwaitingImage) {
    await ctx.reply(
      '⚠️ صديقي، لم تقم باختيار الخدمة أولاً!\\n' +
      'يرجى الضغط على الزر المناسب لتحسين صورتك من القائمة الرئيسية 👆'
    );
    return;
  }
  // ───────────────────────────────\n`;

  if (guardRegex.test(imgTs)) {
    imgTs = imgTs.replace(guardRegex, newGuard);
    console.log('✅ imageHandler.ts guard replaced.');
  } else {
    console.log('❌ imageHandler.ts guard NOT replaced.');
  }

  // Resolution Menu replacement
  const resRegex = /const keyboard = new InlineKeyboard\(\)[\s\S]*?\.text\([^,]+,\s*'locked_8k_ai'\);/m;
  const newResMenu = `const keyboard: any = {
      inline_keyboard: [
        [
          // @ts-ignore
          { text: locks.btn_2k ? '🔒 دقة 2K — مقفلة' : '🚀 دقة 2K — محاولة واحدة', callback_data: 'enhance_2k', style: 'primary' }
        ],
        [
          // @ts-ignore
          { text: locks.btn_4k ? '🔒 دقة 4K — مقفلة' : ' دقة 4K — محاولتان (جودة فائقة)', callback_data: 'enhance_4k', style: 'primary' }
        ],
        [
          // @ts-ignore
          { text: locks.btn_8k ? '🔒 دقة 8K — مقفلة' : '💎 دقة 8K', callback_data: 'locked_8k', style: 'primary' }
        ],
        [
          // @ts-ignore
          { text: locks.btn_4kai ? '🔒 4K-Ai — مقفل' : ' 4K - Ai', callback_data: 'process_4k_ai', style: 'primary' },
          // @ts-ignore
          { text: locks.btn_8kai ? '🔒 8K-Ai — مقفل' : '🔒 8K - Ai', callback_data: 'locked_8k_ai', style: 'primary' }
        ]
      ]
    };`;

  if (resRegex.test(imgTs)) {
    imgTs = imgTs.replace(resRegex, newResMenu);
    
    // Fix the `keyboard.row()` logic that follows for admin
    const adminRegex = /keyboard\.row\(\)\.text\('⚙️ لوحة تحكم الأدمن',\s*'admin_panel'\);/m;
    const newAdminLogic = `keyboard.inline_keyboard.push([{ text: '⚙️ لوحة تحكم الأدمن', callback_data: 'admin_panel' }]);`;
    imgTs = imgTs.replace(adminRegex, newAdminLogic);

    console.log('✅ imageHandler.ts resolution menu replaced.');
  } else {
    console.log('❌ imageHandler.ts resolution menu NOT replaced.');
  }

  fs.writeFileSync('src/bot/handlers/imageHandler.ts', imgTs, 'utf8');

  // ── 2. index.ts (Filter Menu) ──
  let idxTs = fs.readFileSync('src/index.ts', 'utf8');
  const idxFilterRegex = /reply_markup:\s*new\s*InlineKeyboard\(\)[\s\S]*?\.text\('❌ إلغاء',\s*'cancel_filter'\)/m;
  const newIdxFilterMenu = `reply_markup: {
        inline_keyboard: [
          [
            // @ts-ignore
            { text: '👤 تصفية الوجه', callback_data: 'filter_face', style: 'primary' },
            // @ts-ignore
            { text: '🎨 تلوين الصور', callback_data: 'filter_color', style: 'primary' }
          ],
          [
            // @ts-ignore
            { text: '🌸 تحويل أنمي', callback_data: 'filter_anime', style: 'primary' },
            // @ts-ignore
            { text: ' تأثير جيبلي', callback_data: 'filter_ghibli', style: 'primary' }
          ],
          [
            // @ts-ignore
            { text: '❌ إلغاء', callback_data: 'cancel_filter', style: 'danger' }
          ]
        ]
      }`;

  if (idxFilterRegex.test(idxTs)) {
    idxTs = idxTs.replace(idxFilterRegex, newIdxFilterMenu);
    console.log('✅ index.ts filter menu replaced.');
  } else {
    console.log('❌ index.ts filter menu NOT replaced.');
  }

  fs.writeFileSync('src/index.ts', idxTs, 'utf8');

  // ── 3. callbackHandler.ts (Filter Menu) ──
  let cbTs = fs.readFileSync('src/bot/handlers/callbackHandler.ts', 'utf8');
  const cbFilterRegex = /reply_markup:\s*new\s*InlineKeyboard\(\)[\s\S]*?\.text\('❌ إلغاء',\s*'cancel_filter'\)/m;
  const newCbFilterMenu = `reply_markup: {
          inline_keyboard: [
            [
              // @ts-ignore
              { text: '👤 تصفية الوجه', callback_data: 'filter_face', style: 'primary' },
              // @ts-ignore
              { text: '🎨 تلوين الصور', callback_data: 'filter_color', style: 'primary' }
            ],
            [
              // @ts-ignore
              { text: '🌸 تحويل أنمي', callback_data: 'filter_anime', style: 'primary' },
              // @ts-ignore
              { text: ' تأثير جيبلي', callback_data: 'filter_ghibli', style: 'primary' }
            ],
            [
              // @ts-ignore
              { text: '🪄 ترميم الصور القديمة', callback_data: 'filter_restore', style: 'primary' }
            ],
            [
              // @ts-ignore
              { text: '❌ إلغاء', callback_data: 'cancel_filter', style: 'danger' }
            ]
          ]
        }`;

  if (cbFilterRegex.test(cbTs)) {
    cbTs = cbTs.replace(cbFilterRegex, newCbFilterMenu);
    console.log('✅ callbackHandler.ts filter menu replaced.');
  } else {
    console.log('❌ callbackHandler.ts filter menu NOT replaced.');
  }

  fs.writeFileSync('src/bot/handlers/callbackHandler.ts', cbTs, 'utf8');
}

fix();
