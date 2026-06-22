// Jest mock for SCSS-module imports: returns the requested class name as its own value
// so `styles.js_foo` evaluates to the string "js_foo" in tests.
module.exports = new Proxy({}, {
    get: (target, prop) => (typeof prop === 'string' ? prop : undefined)
});
