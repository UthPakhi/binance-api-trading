import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import config from "./firebase-applet-config.json" with { type: 'json' };

const app = initializeApp({ projectId: config.projectId, apiKey: config.apiKey });
const db = getFirestore(app, config.firestoreDatabaseId);

async function check() {
  const snapshot = await getDocs(collection(db, "trades"));
  for (const d of snapshot.docs) {
    const t = d.data();
    if (t.status === 'ACTIVE') {
      console.log("ID:", d.id, "status:", t.status, "realizedProfitUsd:", t.realizedProfitUsd, "feeUsd:", t.feeUsd);
    }
  }
}
check().then(() => process.exit(0));
