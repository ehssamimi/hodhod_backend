// Regenerates docs/openapi/{student,teacher,admin}.openapi.json from the real running API
// (through the disposable-database integration run, which also verifies the contract).
const path = require('node:path');
process.env.OPENAPI_EXPORT_DIR = path.join(__dirname, '..', 'docs', 'openapi');
require('./test-database.cjs');
