import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc } from "firebase/firestore";
import fs from 'fs';

const config = JSON.parse(fs.readFileSync("./firebase-applet-config.json", "utf-8"));
const app = initializeApp({ projectId: config.projectId, apiKey: config.apiKey });
const db = getFirestore(app, config.firestoreDatabaseId);

async function revert() {
  const snapshot = await getDocs(collection(db, "trades"));
  for (const d of snapshot.docs) {
    const t = d.data();
    
    // If the trade has feeUsd and it is not ACTIVE/PENDING, it means we deducted it from realizedProfitUsd
    if (t.feeUsd !== undefined && t.status !== 'ACTIVE' && t.status !== 'PENDING') {
      const newRealized = (t.realizedProfitUsd || 0) + t.feeUsd;
      console.log(`Reverting trade ${d.id}. Adding back ${t.feeUsd} to realized. New realized: ${newRealized}`);
      await updateDoc(doc(db, "trades", d.id), {
        realizedProfitUsd: newRealized,
      });
    }
  }
}
revert().then(() => process.exit(0));
