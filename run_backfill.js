import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc } from "firebase/firestore";
import fs from 'fs';

const config = JSON.parse(fs.readFileSync("./firebase-applet-config.json", "utf-8"));
const app = initializeApp({ projectId: config.projectId, apiKey: config.apiKey });
const db = getFirestore(app, config.firestoreDatabaseId);

const FEE_RATE = 0.001;

async function backfill() {
  const snapshot = await getDocs(collection(db, "trades"));
  for (const d of snapshot.docs) {
    const t = d.data();
    
    // Calculate total buy usd
    const totalBuyUsd = t.totalBuyUsd || (t.entryPrice * t.positionSizeCoins) || 0;
    const buyFeeUsd = totalBuyUsd * FEE_RATE;
    
    let totalFeeUsd = buyFeeUsd;
    let realizedProfit = t.realizedProfitUsd || 0;
    
    // Add exit fees depending on status
    if (t.status === 'HIT_SL') {
      const exitFee = (t.positionSizeCoins * t.stopLoss) * FEE_RATE;
      totalFeeUsd += exitFee;
      // if realized doesn't include fee, adjust it.
      if (t.feeUsd === undefined) {
          // Previously we just did (-riskAmount)
          // So new realized is (-riskAmount) - buyFee - exitFee
          // But maybe they were already adjusted?
          realizedProfit -= totalFeeUsd;
      }
    }
    
    if (t.status === 'HIT_TP1') {
      const soldCoins = t.positionSizeCoins * ( (t.tp1Percent || 100) / 100 );
      const exitFee = (soldCoins * t.takeProfit1) * FEE_RATE;
      totalFeeUsd += exitFee;
      if (t.feeUsd === undefined) {
         realizedProfit -= totalFeeUsd;
      }
    }
    
    if (t.status === 'HIT_TP2') {
      const soldCoins1 = t.positionSizeCoins * ( (t.tp1Percent || 50) / 100 );
      const exitFee1 = (soldCoins1 * t.takeProfit1) * FEE_RATE;
      const soldCoins2 = t.positionSizeCoins * ( (t.tp2Percent || 50) / 100 );
      const exitFee2 = (soldCoins2 * t.takeProfit2) * FEE_RATE;
      totalFeeUsd += exitFee1 + exitFee2;
      if (t.feeUsd === undefined) {
         realizedProfit -= totalFeeUsd;
      }
    }
    
    if (t.status === 'HIT_TP3') {
       // just a simplification for now
       totalFeeUsd = t.feeUsd !== undefined ? t.feeUsd : totalFeeUsd * 2;
       if (t.feeUsd === undefined) {
           realizedProfit -= totalFeeUsd;
       }
    }
    
    // We only update if feeUsd is missing OR if we want to force correct it
    // The user said "You did not add fees for past trades" so let's enforce it on trades where feeUsd is undefined
    if (t.feeUsd === undefined && t.status !== 'ACTIVE' && t.status !== 'PENDING') {
      console.log(`Updating trade ${d.id} (${t.symbol}). Status: ${t.status}. Realized changed from ${t.realizedProfitUsd} to ${realizedProfit}`);
      await updateDoc(doc(db, "trades", d.id), {
        feeUsd: totalFeeUsd,
        realizedProfitUsd: realizedProfit,
        totalProfitPkr: (t.totalProfitUsd || 0) * (t.pkrRate || 278) // just some dummy rewrite if needed
      });
    } else if (t.feeUsd === undefined && t.status === 'ACTIVE') {
      console.log(`Updating ACTIVE trade ${d.id} (${t.symbol}).`);
      await updateDoc(doc(db, "trades", d.id), {
        feeUsd: buyFeeUsd,
      });
    }
  }
}
backfill().then(() => {
    console.log("DONE");
    process.exit(0);
}).catch(e => { 
    console.error(e); 
    process.exit(1); 
});
