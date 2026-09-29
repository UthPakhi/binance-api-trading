const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const targetResponse = `      const buyTotalQty = currentQty;
      const buyTotalCost = currentCost;
      const buyTotalFees = currentFees;
      const sellTotalQty = recentSellQty;
      const sellTotalProceeds = recentSellProceeds;
      const sellTotalFees = recentSellFees;`;
          
const replaceResponse = `      const buyTotalQty = currentQty;
      const buyTotalCost = currentCost;
      const buyTotalFees = currentFees;
      const sellTotalQty = recentSellQty;
      const sellTotalProceeds = recentSellProceeds;
      const sellTotalFees = recentSellFees;
      const buyCountFinal = buyCountInternal;
      const sellCountFinal = sellCountInternal;`;
          
code = code.replace(targetResponse, replaceResponse);

const targetResponse3 = `        openBuys: {
          count: buyCountInternal,`;
          
const replaceResponse3 = `        openBuys: {
          count: buyCountFinal,`;
          
code = code.replace(targetResponse3, replaceResponse3);

const targetResponse4 = `        recentSells: {
          count: sellCountInternal,`;
          
const replaceResponse4 = `        recentSells: {
          count: sellCountFinal,`;
          
code = code.replace(targetResponse4, replaceResponse4);

fs.writeFileSync('server.ts', code);
console.log("Fixed algorithm bounds in server.ts");
