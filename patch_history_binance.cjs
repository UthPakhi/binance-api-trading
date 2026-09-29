const fs = require('fs');
let code = fs.readFileSync('src/components/History.tsx', 'utf-8');

const importStr = `import { Trash2, Edit2, Activity, RefreshCw, Settings } from 'lucide-react';`;
const importNew = `import { Trash2, Edit2, Activity, RefreshCw, Settings, Wallet } from 'lucide-react';
import toast from 'react-hot-toast';`;
code = code.replace(importStr, importNew);

const tempBaseOld = `  const [tempBaseCapital, setTempBaseCapital] = useState(baseCapital.toString());`;
const tempBaseNew = `  const [tempBaseCapital, setTempBaseCapital] = useState(baseCapital.toString());
  const [isSyncing, setIsSyncing] = useState(false);

  const syncBinance = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch('/api/binance/balance');
      const data = await res.json();
      if (data.status === 'success') {
        const bal = data.balance;
        setTempBaseCapital(bal.toString());
        setBaseCapital(bal);
        setIsEditingBase(false);
        toast.success(\`Synced successfully: $\${bal.toFixed(2)}\`);
      } else {
        toast.error(data.message || 'Failed to sync with Binance');
      }
    } catch (e) {
      toast.error('Network error syncing with Binance');
    } finally {
      setIsSyncing(false);
    }
  };`;
code = code.replace(tempBaseOld, tempBaseNew);

const btnOld = `<Button size="sm" onClick={handleSaveBaseCapital} className="h-9">Save</Button>`;
const btnNew = `<Button variant="outline" size="icon" onClick={syncBinance} disabled={isSyncing} className="h-9 w-9 shrink-0 text-blue-400 border-blue-500/30 hover:bg-blue-500/10">
              <Wallet className={\`w-4 h-4 \${isSyncing ? 'animate-pulse' : ''}\`} />
            </Button>
            <Button size="sm" onClick={handleSaveBaseCapital} className="h-9">Save</Button>`;
code = code.replace(btnOld, btnNew);

fs.writeFileSync('src/components/History.tsx', code);
