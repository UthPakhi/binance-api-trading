const fs = require('fs');
let code = fs.readFileSync('src/components/AiSignals.tsx', 'utf-8');

// Lift state outside component
const stateDecl = `let globalSignalsCache: Signal[] = [];
let globalLastGen: number = 0;

export function AiSignals({ onLoadSignal }: AiSignalsProps) {`;

code = code.replace("export function AiSignals({ onLoadSignal }: AiSignalsProps) {", stateDecl);

// Update fetch logic
const oldFetch = `
  const fetchSignals = async (forceRefresh = false) => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai-signals' + (forceRefresh ? '?force=true' : ''));
      const data = await res.json();
      if (data.status === 'success' && data.signals) {
        // Sort highest confidence first
        data.signals.sort((a: any, b: any) => b.confidence - a.confidence);
        setSignals(data.signals);
        setLastGeneratedAt(data.generatedAt);
        if (data.isStale) {
          toast.error("Failed to reach AI Engine. Showing cached signals.", { id: 'stale-signals' });
        }
      }
    } catch (e) {
      console.error(e);
      toast.error("Error fetching AI Signals");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSignals();
    // Poll every 5 minutes in background
    const int = setInterval(() => fetchSignals(), 5 * 60 * 1000);
    return () => clearInterval(int);
  }, []);
`;

const newFetch = `
  const fetchSignals = async (forceRefresh = false) => {
    if (forceRefresh || globalSignalsCache.length === 0) setLoading(true);
    try {
      const res = await fetch('/api/ai-signals' + (forceRefresh ? '?force=true' : ''));
      const data = await res.json();
      if (data.status === 'success' && data.signals) {
        // Sort highest confidence first
        data.signals.sort((a: any, b: any) => b.confidence - a.confidence);
        
        globalSignalsCache = data.signals;
        globalLastGen = data.generatedAt;
        
        setSignals(data.signals);
        setLastGeneratedAt(data.generatedAt);
        if (data.isStale && forceRefresh) {
          toast.error("Failed to reach AI Engine. Showing cached signals.", { id: 'stale-signals' });
        } else if (forceRefresh) {
          toast.success("AI Desk refreshed!");
        }
      }
    } catch (e) {
      console.error(e);
      if (forceRefresh) toast.error("Error fetching AI Signals");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (globalSignalsCache.length > 0) {
      setSignals(globalSignalsCache);
      setLastGeneratedAt(globalLastGen);
      setLoading(false);
      // Silent background fetch to check for updates
      fetchSignals(false);
    } else {
      fetchSignals(false);
    }
    
    // Poll every 5 minutes in background
    const int = setInterval(() => fetchSignals(false), 5 * 60 * 1000);
    return () => clearInterval(int);
  }, []);
`;

code = code.replace(oldFetch, newFetch);
fs.writeFileSync('src/components/AiSignals.tsx', code);
console.log("Patched AiSignals to use global module cache to prevent reload flashing.");
