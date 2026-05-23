const fs = require('fs');
const path = require('path');

function searchFiles(dir, queries, results = {}) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      searchFiles(fullPath, queries, results);
    } else if (fullPath.endsWith('.ts')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        for (const [key, q] of Object.entries(queries)) {
          if (q instanceof RegExp ? q.test(lines[i]) : lines[i].includes(q)) {
            if (!results[key]) results[key] = [];
            results[key].push({ file: fullPath, lineNum: i + 1, content: lines[i].trim() });
          }
        }
      }
    }
  }
  return results;
}

const queries = {
  edit_callback: /edit_doc|edit_pdf_doc|registerDocCallback\('edit_doc|registerDocCallback\('edit_pdf_doc/,
  lastPdfMode: /lastPdfMode\s*=/,
  handleProEdit: /function handleProEdit|const handleProEdit/,
  handleAutoEdit: /function handleAutoEdit|const handleAutoEdit/,
  awaitingAutoEdit: /awaitingAutoEdit|awaitingProEditText/
};

const results = searchFiles('src', queries);
console.log(JSON.stringify(results, null, 2));
