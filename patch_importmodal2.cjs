const fs = require('fs');
let code = fs.readFileSync('src/components/ImportTradeModal.tsx', 'utf-8');
code = code.replace('<p>No Spot holdings found (value > $5).</p>', '<p>No Spot holdings found (value &gt; $5).</p>');
fs.writeFileSync('src/components/ImportTradeModal.tsx', code);
