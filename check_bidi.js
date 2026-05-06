const bidi = require('bidi-js');
console.log('type:', typeof bidi);
console.log('keys:', Object.keys(bidi).join(', '));
if (typeof bidi === 'function') {
  const engine = bidi();
  console.log('engine keys:', Object.keys(engine).join(', '));
}
const arabicReshaper = require('arabic-reshaper');
console.log('reshaper keys:', Object.keys(arabicReshaper).join(', '));
const test = arabicReshaper.reshape('مرحبا');
console.log('reshaped:', test);
