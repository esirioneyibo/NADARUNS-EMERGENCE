// app.config.js - Dynamic Expo configuration
// This file allows us to pass environment variables to EAS builds

export default ({ config }) => {
  return {
    ...config,
    extra: {
      // Backend URL - will be bundled into the app during EAS build
      backendUrl: process.env.EXPO_PUBLIC_BACKEND_URL || "https://api.nadaruns.com",
    },
  };
};
