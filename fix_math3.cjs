const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const targetAnalyzeTrade = `      let buyCount = 0;
      let sellCount = 0;

      for (const t of sorted) {`;
      
const replaceAnalyzeTrade = `      let buyCountInternal = 0;
      let sellCountInternal = 0;

      for (const t of sorted) {`;
      
code = code.replace(targetAnalyzeTrade, replaceAnalyzeTrade);

code = code.replace(/buyCount\+\+/g, 'buyCountInternal++');
code = code.replace(/sellCount\+\+/g, 'sellCountInternal++');
code = code.replace(/buyCount = 0/g, 'buyCountInternal = 0');
code = code.replace(/sellCount = 0/g, 'sellCountInternal = 0');

const targetResponse = `        openBuys: {
          count: buyCount,`;
          
const replaceResponse = `        openBuys: {
          count: buyCountInternal,`;
          
code = code.replace(targetResponse, replaceResponse);

const targetResponse2 = `        recentSells: {
          count: sellCount,`;
          
const replaceResponse2 = `        recentSells: {
          count: sellCountInternal,`;
          
code = code.replace(targetResponse2, replaceResponse2);

fs.writeFileSync('server.ts', code);
console.log("Fixed algorithm bounds in server.ts");
