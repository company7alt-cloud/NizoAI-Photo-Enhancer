const fs = require('fs');

const indexLines = fs.readFileSync('src/index.ts', 'utf8').split('\n');
const validatorLines = fs.readFileSync('src/utils/validators.ts', 'utf8').split('\n');

console.log('=== AUDIT ===');

// Task 1: find "const isAdm = adminIds.includes"
for (let i = 0; i < indexLines.length; i++) {
  if (indexLines[i].includes('isAdm') && indexLines[i].includes('adminIds.includes')) {
    console.log(`TASK1 isAdm line: ${i+1} → ${JSON.stringify(indexLines[i])}`);
    // Show 3 lines around it
    console.log(`  L${i}: ${JSON.stringify(indexLines[i-1])}`);
    console.log(`  L${i+1}: ${JSON.stringify(indexLines[i])}`);
    console.log(`  L${i+2}: ${JSON.stringify(indexLines[i+1])}`);
  }
}

// Task 2: find "imageBot.callbackQuery" with "callbackHandler"
for (let i = 0; i < indexLines.length; i++) {
  if (indexLines[i].includes('imageBot.callbackQuery') && indexLines[i].includes('callbackHandler')) {
    console.log(`TASK2 callbackQuery/callbackHandler line: ${i+1} → ${JSON.stringify(indexLines[i])}`);
    console.log(`  L${i}: ${JSON.stringify(indexLines[i-1])}`);
    console.log(`  L${i+1}: ${JSON.stringify(indexLines[i])}`);
    console.log(`  L${i+2}: ${JSON.stringify(indexLines[i+1])}`);
  }
}

// Task 3: check validators.ts for activeFilter and awaitingImage
for (let i = 0; i < validatorLines.length; i++) {
  if (validatorLines[i].includes('activeFilter')) {
    console.log(`TASK3 activeFilter already at line ${i+1}: ${JSON.stringify(validatorLines[i])}`);
  }
  if (validatorLines[i].includes('awaitingImage')) {
    console.log(`TASK3 awaitingImage at line ${i+1}: ${JSON.stringify(validatorLines[i])}`);
  }
}

// Find end of SessionData interface in validators.ts
for (let i = 0; i < validatorLines.length; i++) {
  if (validatorLines[i].includes('currentService')) {
    console.log(`TASK3 currentService (near SessionData end) at line ${i+1}: ${JSON.stringify(validatorLines[i])}`);
    console.log(`  L${i+2}: ${JSON.stringify(validatorLines[i+1])}`);
    console.log(`  L${i+3}: ${JSON.stringify(validatorLines[i+2])}`);
    console.log(`  L${i+4}: ${JSON.stringify(validatorLines[i+3])}`);
  }
}
