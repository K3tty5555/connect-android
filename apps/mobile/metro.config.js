const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const repositoryRoot = path.resolve(projectRoot, '../..');
const config = getDefaultConfig(projectRoot);

// Mobile runtime reuses pure contract helpers from src/shared. Keep dependency
// resolution rooted in the isolated mobile project while allowing Metro to
// watch that single repository-owned source tree.
config.watchFolders = [repositoryRoot];
config.resolver.nodeModulesPaths = [path.join(projectRoot, 'node_modules')];

module.exports = config;
