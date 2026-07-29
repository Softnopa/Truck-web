// babel-preset-expo (SDK 54+) wires up the react-native-worklets plugin that
// Reanimated needs, so it must stay last and must not be duplicated here.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
