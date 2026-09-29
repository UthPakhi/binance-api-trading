const fs = require('fs');
let code = fs.readFileSync('src/components/Calculator.tsx', 'utf-8');

const original = `<div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-neutral-100 flex items-center gap-2">
              Trade Setup
            </h2>
            <div className="flex gap-1.5 ml-2">`;

const replacement = `<div className="flex flex-col sm:flex-row sm:items-center justify-between mb-5 gap-3">
          <h2 className="text-xl font-bold text-neutral-100 whitespace-nowrap">
            Trade Setup
          </h2>
          <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto">
            <div className="flex gap-1.5">`;

// Note: We need to also move the reset button logic, but let's just make sure Trade Setup doesn't wrap and the buttons scroll or sit nicely. 
// Simpler fix:
const simpleRepl = `<div className="flex justify-between items-start sm:items-center mb-5 gap-3 flex-col sm:flex-row">
          <h2 className="text-xl font-bold text-neutral-100 whitespace-nowrap">
            Trade Setup
          </h2>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
            <div className="flex gap-1.5">`;

code = code.replace(original, simpleRepl);

// Wait, I need to match the actual code in Calculator.tsx because spaces might be different. 
