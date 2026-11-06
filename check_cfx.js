import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const config = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf-8'));
const app = initializeApp(config);
const db = getFirestore(app);

async function run() {
  const snap = await getDocs(collection(db, 'trades'));
  snap.docs.forEach(docSnap => {
    const data = docSnap.id;
    const t = docSnap.data();
    if ((t.symbol || '').toUpperCase().includes('CFX')) {
      console.log('ID:', docSnap.id, 'Symbol:', t.symbol, 'Status:', t.status, 'ClosedAt:', t.closedAt, 'CreatedAt:', t.createdAt, 'FilledAt:', t.filledAt, 'RealizedPnL:', t.realizedProfitUsd);
    }
  });
}
run();
