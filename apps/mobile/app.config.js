// Adds the Google OAuth redirect scheme (the reversed client ID) to app.json at build time.
// Set EXPO_PUBLIC_GOOGLE_CLIENT_ID (see .env.example) for a development build.
module.exports = ({ config }) => {
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
  const scheme = clientId ? `com.googleusercontent.apps.${clientId.replace(/\.apps\.googleusercontent\.com$/, '')}` : undefined;
  return { ...config, ...(scheme ? { scheme } : {}) };
};
