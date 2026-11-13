const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
// This repo has separate Go/Expo projects rather than an npm workspace.
// Include the shared schema outside the Expo project root in Metro's file map.
config.watchFolders = [...config.watchFolders, path.resolve(__dirname, '../../protocol')];
module.exports = config;
