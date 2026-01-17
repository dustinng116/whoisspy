const fs = require('fs');

const env = process.env;

const content = `
export const firebaseConfig = {
  apiKey: "${env.NG_APP_FIREBASE_API_KEY}",
  authDomain: "${env.NG_APP_FIREBASE_AUTH_DOMAIN}",
  databaseURL: "${env.NG_APP_FIREBASE_DB_URL}",
  projectId: "${env.NG_APP_FIREBASE_PROJECT_ID}"
};
`;

fs.writeFileSync(
  './src/environments/firebase.config.ts',
  content.trim()
);
