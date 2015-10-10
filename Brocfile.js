var compileTypescript = require('./index.js');

var srcDir = 'tests/src';

var TypescriptTree = compileTypescript(srcDir, {sourcemap: true});

module.exports = TypescriptTree;
