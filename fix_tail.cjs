const fs = require('fs');
let code = fs.readFileSync('src/components/AiSignals.tsx', 'utf-8');
const tailTarget = `      )}
        </>
      )}
    </div>
  );
}`;

const tailReplacement = `      )}
    </div>
  );
}`;

code = code.replace(tailTarget, tailReplacement);
fs.writeFileSync('src/components/AiSignals.tsx', code);
console.log("Fixed tail logic!");
