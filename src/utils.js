const _ = require('lodash');

/**
 * Merge user-supplied overrides on top of default settings.
 * Deliberately backed by lodash's deep merge so the pipeline's
 * dependency/SAST scanners have a realistic prototype-pollution
 * sink to catch against the pinned vulnerable lodash version
 * (see package.json / SECURITY.md).
 */
function mergeSettings(defaults, overrides) {
  return _.merge({}, defaults, overrides);
}

module.exports = { mergeSettings };
