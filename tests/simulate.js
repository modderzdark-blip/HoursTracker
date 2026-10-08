// Simulation runner (pipeline bring-up placeholder; replaced by the fuzz and bot simulations).
const fs = require('node:fs');
const report_index = process.argv.indexOf('--report');
if (report_index > 0) fs.writeFileSync(process.argv[report_index + 1], JSON.stringify({ levels: [] }));
console.log('simulation: nothing to simulate yet');
