const fs = require('fs');
let code = fs.readFileSync('src/components/History.tsx', 'utf-8');

// Imports
code = code.replace(
  `import { db } from '../lib/firebase';\nimport { deleteDoc, doc } from 'firebase/firestore';`,
  `import { auth, db } from '../lib/firebase';\nimport { deleteDoc, doc, collection, addDoc } from 'firebase/firestore';`
);

code = code.replace(
  `import { Trash2, Edit2, Activity, RefreshCw, Settings, Wallet, List, LayoutGrid } from 'lucide-react';`,
  `import { Trash2, Edit2, Activity, RefreshCw, Settings, Wallet, List, LayoutGrid, CloudDownload } from 'lucide-react';`
);

code = code.replace(
  `import { Input } from './Input';`,
  `import { Input } from './Input';\nimport { ImportTradeModal } from './ImportTradeModal';`
);

// State
code = code.replace(
  `const [compactView, setCompactView] = useState(() => localStorage.getItem('history_compact') === 'true');`,
  `const [compactView, setCompactView] = useState(() => localStorage.getItem('history_compact') === 'true');\n  const [showImportModal, setShowImportModal] = useState(false);`
);

// Header button
const headerOld = `          <Button variant="ghost" size="icon" onClick={toggleCompact} className="text-neutral-500 hover:text-blue-400 h-8 w-8" title="Toggle Compact View">`;
const headerNew = `          <Button variant="ghost" size="icon" onClick={() => setShowImportModal(true)} className="text-neutral-500 hover:text-blue-400 h-8 w-8" title="Sync Live Position">
            <CloudDownload className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={toggleCompact} className="text-neutral-500 hover:text-blue-400 h-8 w-8" title="Toggle Compact View">`;
code = code.replace(headerOld, headerNew);

// Import Modal JSX
const closeDivOld = `      {editingTrade && (
        <EditTradeModal trade={editingTrade} onClose={() => setEditingTrade(null)} />
      )}
    </div>
  );
}`;

const closeDivNew = `      {editingTrade && (
        <EditTradeModal trade={editingTrade} onClose={() => setEditingTrade(null)} />
      )}
      {showImportModal && (
        <ImportTradeModal 
          onClose={() => setShowImportModal(false)}
          onSelect={async (sym, importedEntry, size) => {
            try {
              if (!auth.currentUser) {
                toast.error("Not logged in");
                return;
              }
              const newTrade = {
                userId: auth.currentUser.uid,
                symbol: sym,
                portfolioSize: baseCapital,
                riskPercent: 1,
                entryPrice: importedEntry,
                stopLoss: 0,
                takeProfit1: 0,
                tp1Percent: 100,
                riskAmount: 0,
                positionSizeCoins: size,
                totalBuyUsd: size * importedEntry,
                status: 'ACTIVE',
                notes: 'Imported from Binance Spot',
                createdAt: Date.now(),
                pkrRate: 285
              };
              await addDoc(collection(db, 'trades'), newTrade);
              setShowImportModal(false);
              toast.success(\`Imported \${sym}\`);
            } catch (e) {
              console.error(e);
              toast.error("Failed to import trade");
            }
          }}
        />
      )}
    </div>
  );
}`;
code = code.replace(closeDivOld, closeDivNew);

fs.writeFileSync('src/components/History.tsx', code);
