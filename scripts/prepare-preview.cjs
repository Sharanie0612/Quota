// One preview preparation path for both interactive review and source-board checks.
require('./lib/preview.cjs').preparePreview(require('node:path').resolve(__dirname,'..'));
