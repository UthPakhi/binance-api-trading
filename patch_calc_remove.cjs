const fs = require('fs');
let code = fs.readFileSync('src/components/Calculator.tsx', 'utf-8');

// remove imports
code = code.replace(`import { ImportTradeModal } from './ImportTradeModal';`, ``);
code = code.replace(`import { CloudDownload } from 'lucide-react';`, ``);

// remove state
code = code.replace(`  const [showImportModal, setShowImportModal] = useState(false);`, ``);

// remove button
const btnOld = `<h2 className="text-lg font-semibold text-neutral-100 flex flex-col gap-1">
              <span>Trade Setup</span>
              <button 
                onClick={() => setShowImportModal(true)}
                className="text-[10px] text-blue-400 font-semibold flex items-center gap-1 hover:text-blue-300"
              >
                <CloudDownload className="w-3 h-3" /> Sync Live Position
              </button>
            </h2>`;
const btnNew = `<h2 className="text-lg font-semibold text-neutral-100 flex items-center gap-2">
              Trade Setup
            </h2>`;
code = code.replace(btnOld, btnNew);

// remove modal html
const modalOld = `      {showImportModal && (
        <ImportTradeModal 
          onClose={() => setShowImportModal(false)}
          onSelect={(sym, importedEntry, size) => {
            setSymbol(sym);
            setEntry(importedEntry.toString());
            setShowImportModal(false);
            toast.success(\`Imported \${sym}\`);
          }}
        />
      )}`;
code = code.replace(modalOld, ``);

fs.writeFileSync('src/components/Calculator.tsx', code);
