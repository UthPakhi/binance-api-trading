const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

const oldSwitch = `        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className={cn("h-full transition-opacity duration-300", activeTab === 'calc' ? 'opacity-100' : 'hidden')}>
            <Calculator loadedSignal={activeSignal} />
          </div>
          <div className={cn("h-full transition-opacity duration-300", activeTab === 'signals' ? 'opacity-100' : 'hidden')}>
            <AiSignals onLoadSignal={handleLoadSignal} />
          </div>
          <div className={cn("h-full transition-opacity duration-300", activeTab === 'hist' ? 'opacity-100' : 'hidden')}>
            <History />
          </div>
        </main>`;

const newSwitch = `        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className={cn("h-full transition-opacity duration-300", activeTab === 'calc' ? 'opacity-100 block' : 'opacity-0 hidden')}>
            <Calculator loadedSignal={activeSignal} />
          </div>
          <div className={cn("h-full transition-opacity duration-300", activeTab === 'signals' ? 'opacity-100 block' : 'opacity-0 hidden')}>
            <AiSignals onLoadSignal={handleLoadSignal} />
          </div>
          <div className={cn("h-full transition-opacity duration-300", activeTab === 'hist' ? 'opacity-100 block' : 'opacity-0 hidden')}>
            <History />
          </div>
        </main>`;

code = code.replace(oldSwitch, newSwitch);
fs.writeFileSync('src/App.tsx', code);
