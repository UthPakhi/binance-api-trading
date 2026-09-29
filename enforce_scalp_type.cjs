const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const t = 'type: { type: Type.STRING, description: "Scalp, Day, or Swing" },';
const r = 'type: { type: Type.STRING, description: "Must ALWAYS be \'Scalp\'" },';

code = code.replace(t, r);
fs.writeFileSync('server.ts', code);
console.log("Enforced scalp type in schema");
