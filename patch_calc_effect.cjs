const fs = require('fs');
let code = fs.readFileSync('src/components/Calculator.tsx', 'utf-8');

const oldEffect = `  useEffect(() => {
    if (loadedSignal) {
      setSymbol(loadedSignal.symbol);
      setEntry(loadedSignal.entry.toString());
      setSl(loadedSignal.sl.toString());
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
      if (symbol !== loadedSignal.symbol || entry !== loadedSignal.entry?.toString()) {
        setSymbol(loadedSignal.symbol || '');
        setEntry(loadedSignal.entry?.toString() || '');
        setSl(loadedSignal.sl?.toString() || '');
        setTp1(loadedSignal.tp1?.toString() || '');
        setTp2(loadedSignal.tp2?.toString() || '');
        setTp3(loadedSignal.tp3?.toString() || '');
        
        // Only override percentages if the signal explicitly provides a non-zero percentage layout
        const p1 = loadedSignal.tp1Pct || 0;
        const p2 = loadedSignal.tp2Pct || 0;
        const p3 = loadedSignal.tp3Pct || 0;
        if (p1 + p2 + p3 > 0) {
          setTp1Pct(p1.toString());
          setTp2Pct(p2.toString());
          setTp3Pct(p3.toString());
        } else {
          // If the AI forgot to generate percentages, default to 100% on TP1 to avoid errors
          setTp1Pct('100');
          setTp2Pct('0');
          setTp3Pct('0');
        }
        
        setNotes(loadedSignal.notes || '');
        toast.dismiss(); // Clear any existing toasts
        toast.success(\`\${loadedSignal.symbol} AI Setup Loaded!\`);
      }
    }
  }, [loadedSignal]);`;

code = code.replace(oldEffect, newEffect);
fs.writeFileSync('src/components/Calculator.tsx', code);
console.log("Patched Calculator.tsx useEffect");
