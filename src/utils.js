const _ = require('lodash');

/**
 * Merge user-supplied overrides on top of default settings.
 * Backed by lodash's deep merge on purpose: it is a realistic
 * prototype-pollution sink, so the dependency/SAST scanners (and the unit
 * test in test/app.test.js) have a real code path to guard. Patched lodash
 * (>= 4.17.21) ignores __proto__ keys; the first git commit pinned 4.17.15,
 * which did not (see SECURITY.md).
 */
function mergeSettings(defaults, overrides) {
  return _.merge({}, defaults, overrides);
}

module.exports = { mergeSettings };
