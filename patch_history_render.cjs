const fs = require('fs');
let code = fs.readFileSync('src/components/History.tsx', 'utf-8');

// Replace compactView with isTradeCompact(trade.id || '')
code = code.replace(
  `            <div key={trade.id} className={\`bg-neutral-900 rounded-xl border border-neutral-800 shadow-sm relative \${compactView ? 'p-3 flex justify-between items-center' : 'p-4'}\`}>
              {compactView ? (`,
  `            <div key={trade.id} className={\`bg-neutral-900 rounded-xl border border-neutral-800 shadow-sm relative transition-all \${isTradeCompact(trade.id || '') ? 'p-3 flex justify-between items-center hover:border-neutral-700' : 'p-4'}\`}>
              {isTradeCompact(trade.id || '') ? (`
);

// Add Chevron and Sync button to compact view
const compactActionsOld = `                    <div className="flex flex-col gap-1 ml-2 pl-2 border-l border-neutral-800">
                      <Button variant="ghost" size="icon" onClick={() => setEditingTrade(trade)} className="text-neutral-500 hover:text-blue-400 h-6 w-6">
                        <Edit2 className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => trade.id && handleDelete(trade.id)} className="text-neutral-500 hover:text-red-400 h-6 w-6">
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>`;

const compactActionsNew = `                    <div className="flex flex-col gap-1 ml-2 pl-2 border-l border-neutral-800">
                      <Button variant="ghost" size="icon" onClick={() => toggleLocalCompact(trade.id || '')} className="text-neutral-500 hover:text-white h-6 w-6">
                        <ChevronDown className="w-4 h-4" />
                      </Button>
                    </div>`;
code = code.replace(compactActionsOld, compactActionsNew);


// Add Chevron and Sync to expanded view header
const expandedHeaderOld = `              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-neutral-100">{trade.symbol || 'UNNAMED'}</h3>`;

const expandedHeaderNew = `              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-neutral-100">{trade.symbol || 'UNNAMED'}</h3>`;

code = code.replace(expandedHeaderOld, expandedHeaderNew);

const expandedActionsOld = `                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={() => setEditingTrade(trade)} className="text-neutral-500 hover:text-blue-400 h-8 w-8">
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => trade.id && handleDelete(trade.id)} className="text-neutral-500 hover:text-red-400 h-8 w-8">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>`;

const expandedActionsNew = `                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={() => handleSyncExecutions(trade)} disabled={syncingExecutions[trade.id || '']} className="text-neutral-500 hover:text-blue-400 h-8 w-8" title="Sync Executions from Binance">
                    <Wand2 className={\`w-4 h-4 \${syncingExecutions[trade.id || ''] ? 'animate-pulse text-blue-400' : ''}\`} />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setEditingTrade(trade)} className="text-neutral-500 hover:text-emerald-400 h-8 w-8" title="Edit">
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => trade.id && handleDelete(trade.id)} className="text-neutral-500 hover:text-red-400 h-8 w-8" title="Delete">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => toggleLocalCompact(trade.id || '')} className="text-neutral-400 hover:text-white h-8 w-8" title="Collapse">
                    <ChevronUp className="w-5 h-5" />
                  </Button>
                </div>`;

code = code.replace(expandedActionsOld, expandedActionsNew);

fs.writeFileSync('src/components/History.tsx', code);
