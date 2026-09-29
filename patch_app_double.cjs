const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

// The notification currently fires when loadedSignal changes, but if it gets set to the same signal twice or something it might fire again.
// Let's modify the useEffect to use a ref to prevent double firing.
const oldEffect = `  useEffect(() => {
    if (loadedSignal) {
      setSymbol(loadedSignal.symbol);
      setEntryPrice(loadedSignal.entry.toString());
      setStopLoss(loadedSignal.sl.toString());
      setTp1(loadedSignal.tp1.toString());
      setTp2(loadedSignal.tp2.toString());
      setTp3(loadedSignal.tp3.toString());
      setTp1Pct(loadedSignal.tp1Pct.toString());
      setTp2Pct(loadedSignal.tp2Pct.toString());
      setTp3Pct(loadedSignal.tp3Pct.toString());
      setNotes(loadedSignal.notes);
      toast.success(\`\${loadedSignal.symbol} AI Setup Loaded!\`);
    }
  }, [loadedSignal]);`;

const newEffect = `  useEffect(() => {
    if (loadedSignal) {
      // Prevent double firing by checking if it's already exactly the same in state
      if (symbol !== loadedSignal.symbol || entryPrice !== loadedSignal.entry.toString()) {
        setSymbol(loadedSignal.symbol);
        setEntryPrice(loadedSignal.entry.toString());
        setStopLoss(loadedSignal.sl.toString());
        setTp1(loadedSignal.tp1.toString());
        setTp2(loadedSignal.tp2.toString());
        setTp3(loadedSignal.tp3.toString());
        setTp1Pct(loadedSignal.tp1Pct.toString());
        setTp2Pct(loadedSignal.tp2Pct.toString());
        setTp3Pct(loadedSignal.tp3Pct.toString());
        setNotes(loadedSignal.notes);
        toast.dismiss(); // Clear existing toasts
        toast.success(\`\${loadedSignal.symbol} AI Setup Loaded!\`);
      }
    }
  }, [loadedSignal]);`;

code = code.replace(oldEffect, newEffect);
fs.writeFileSync('src/components/Calculator.tsx', fs.readFileSync('src/components/Calculator.tsx', 'utf-8').replace(oldEffect, newEffect));
console.log("Patched Calculator for double toast");
