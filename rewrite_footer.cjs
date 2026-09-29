const fs = require('fs');
let code = fs.readFileSync('src/components/AiSignals.tsx', 'utf-8');

const targetStr = `) : (
            <div className="text-center text-neutral-500 text-xs py-8 bg-neutral-900 rounded-xl border border-neutral-800">No active scans.</div>
          )}
        </div>
      ) : loading && signals.length === 0 ? (`;

const replaceStr = `) : (
            <div className="text-center text-neutral-500 text-xs py-8 bg-neutral-900 rounded-xl border border-neutral-800">No active scans.</div>
          )}
        </div>
      ) : loading && signals.length === 0 ? (`;

const bottomStr = `    </div>
  );
}`;

if (code.includes(bottomStr) && !code.includes("</>")) {
  code = code.replace(bottomStr, `        </>
      )}
    </div>
  );
}`);
  fs.writeFileSync('src/components/AiSignals.tsx', code);
  console.log("Rewrote footer");
} else {
  console.log("Not needed or already patched");
}
