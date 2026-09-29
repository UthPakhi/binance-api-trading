const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const targetAnalyzeResponse = `        openBuys: {
          count: openBuysCount,`;

const replaceAnalyzeResponse = `        openBuys: {
          count: buyCount,`;

code = code.replace(targetAnalyzeResponse, replaceAnalyzeResponse);
          
const targetAnalyzeResponse2 = `        recentSells: {
          count: exitSellsCount,`;

const replaceAnalyzeResponse2 = `        recentSells: {
          count: sellCount,`;

code = code.replace(targetAnalyzeResponse2, replaceAnalyzeResponse2);
fs.writeFileSync('server.ts', code);
console.log("Fixed count");
