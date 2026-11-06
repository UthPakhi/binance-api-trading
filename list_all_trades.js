import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const config = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf-8'));
const app = initializeApp(config);
const db = getFirestore(app);

async function run() {
  const snap = await getDocs(collection(db, 'trades'));
  console.log('Total trades in Firestore:', snap.size);
  snap.docs.forEach(d => {
    const data = d.data();
    console.log(d.id, data.symbol, data.status, data.realizedProfitUsd);
  });
}
run();
