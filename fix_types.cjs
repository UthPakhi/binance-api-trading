const fs = require('fs');
let code = fs.readFileSync('src/types.ts', 'utf-8');

code = code.replace(
`  positionSizeCoins: number;`,
`  positionSizeCoins: number;
  isLong?: boolean;`
);
fs.writeFileSync('src/types.ts', code);
console.log("Added isLong to Trade type");
