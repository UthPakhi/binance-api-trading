const fs = require('fs');
let code = fs.readFileSync('src/components/AiSignals.tsx', 'utf-8');

const target = `        </div>
        
      </div>

      {viewMode === 'log' ? (`;

const replace = `      {viewMode === 'log' ? (`;

code = code.replace(target, replace);
fs.writeFileSync('src/components/AiSignals.tsx', code);
console.log("Fixed syntax");
