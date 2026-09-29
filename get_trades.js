import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import fs from 'fs';

const config = JSON.parse(fs.readFileSync("./firebase-applet-config.json", "utf-8"));
const app = initializeApp({ projectId: config.projectId, apiKey: config.apiKey });
const db = getFirestore(app, config.firestoreDatabaseId);

async function check() {
  const snapshot = await getDocs(collection(db, "trades"));
  for (const d of snapshot.docs) {
    const t = d.data();
    console.log(`ID: ${d.id}, symbol: ${t.symbol}, status: ${t.status}, realizedProfitUsd: ${t.realizedProfitUsd}, feeUsd: ${t.feeUsd}, totalBuyUsd: ${t.totalBuyUsd}`);
  }
}
check().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
