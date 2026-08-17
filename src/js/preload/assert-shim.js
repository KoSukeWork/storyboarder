const assert = (condition, message) => { if (!condition) throw new Error(message || 'Assertion failed') }
assert.equal = (actual, expected, message) => { if (actual != expected) throw new Error(message || `Expected ${actual} == ${expected}`) }
assert.strictEqual = (actual, expected, message) => { if (actual !== expected) throw new Error(message || `Expected ${actual} === ${expected}`) }
assert.ok = assert
module.exports = assert
