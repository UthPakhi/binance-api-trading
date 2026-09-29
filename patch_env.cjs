const fs = require('fs');
let code = fs.readFileSync('.env.example', 'utf-8');
code += '\n# Binance API Keys (Read Only)\nBINANCE_API_KEY=\nBINANCE_API_SECRET=\n';
fs.writeFileSync('.env.example', code);
