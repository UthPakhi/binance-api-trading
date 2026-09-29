const fs = require('fs');
let code = fs.readFileSync('src/components/Calculator.tsx', 'utf-8');

if (!code.includes('loadedSignal?: any;')) {
  // Add prop type
  code = code.replace(
    'export function Calculator() {',
    `export function Calculator({ loadedSignal }: { loadedSignal?: any }) {`
  );

  // Add useEffect to populate fields
  const effect = `
  // Load signal if provided
  useEffect(() => {
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
  }, [loadedSignal]);
`;

  code = code.replace(
    'const [customRiskAmount, setCustomRiskAmount] = useState<string>(\'\');',
    'const [customRiskAmount, setCustomRiskAmount] = useState<string>(\'\');\n' + effect
  );
  
  fs.writeFileSync('src/components/Calculator.tsx', code);
  console.log("Patched Calculator.tsx");
} else {
  console.log("Already patched");
}
