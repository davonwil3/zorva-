const NodeCache = require('node-cache')
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

module.exports = cache;