const path = require('path');
const loadEnv = require('./src/util/loadEnv');

loadEnv();

const { createApp } = require('./src/http/miniHttp');
const staticMiddleware = require('./src/http/staticMiddleware');
const { attachUser } = require('./src/middleware/auth');

const store = require('./src/services/store');
const credentials = require('./src/services/credentialsStore');
const { loadSeed } = require('./src/services/db');

const createAuthRouter = require('./src/routes/auth');
const createStaffRouter = require('./src/routes/staff');
const createRecordsRouter = require('./src/routes/records');
const createMetaRouter = require('./src/routes/meta');

const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_HOURS || 12) * 3600;
const PENDING_TTL_SECONDS = 5 * 60;
const SUPER_ADMIN_USERNAME = process.env.SUPER_ADMIN_USERNAME || 'מארק';
const DEFAULT_STAFF_PASSWORD = process.env.DEFAULT_STAFF_PASSWORD || 'chop';
const SUPER_ADMIN_SECRET_PASSWORD = process.env.SUPER_ADMIN_SECRET_PASSWORD || 'Mark2013';
const IS_PROD = process.env.NODE_ENV === 'production';

if (JWT_SECRET === 'dev-secret-change-me') {
  console.warn(
    '[security] JWT_SECRET is not set in backend/.env - using an insecure default. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
  );
}

const FIREBASE_CONFIG = {
  apiKey: process.env.FIREBASE_API_KEY,
  projectId: process.env.FIREBASE_PROJECT_ID,
};

async function main() {
  // --- Configure where login credentials (password hashes) live. When
  // Firebase is configured, Firestore is the source of truth so passwords
  // survive a redeploy on hosts like Render that don't keep local disk
  // changes between deploys; the local file remains an automatic fallback
  // if Firestore is briefly unreachable. ---
  credentials.configureCloud(FIREBASE_CONFIG);

  // --- Seed login credentials for the staff captured from the old app's live data. ---
  // Safe to run on every start: it never overwrites a password that's
  // already set (locally or in the cloud).
  const seed = loadSeed();
  const credentialSeeds = seed.staff.map((member) => ({
    username: member.username,
    password: DEFAULT_STAFF_PASSWORD,
    secondary: member.username === SUPER_ADMIN_USERNAME ? SUPER_ADMIN_SECRET_PASSWORD : undefined,
  }));
  await credentials.ensureSeeded(credentialSeeds);

  // --- Configure Firestore for staff/records (optional). Falls back to local JSON automatically if unreachable. ---
  store.configureCloud(FIREBASE_CONFIG);
  await store.retryCloudIfConfigured().catch(() => {});

  const app = createApp();

  app.use(attachUser(JWT_SECRET));

  app.use('/api/auth', createAuthRouter({
    jwtSecret: JWT_SECRET,
    sessionTtlSeconds: SESSION_TTL_SECONDS,
    pendingTtlSeconds: PENDING_TTL_SECONDS,
    superAdminUsername: SUPER_ADMIN_USERNAME,
    isProd: IS_PROD,
  }));
  app.use('/api/staff', createStaffRouter({
    superAdminUsername: SUPER_ADMIN_USERNAME,
    defaultPassword: DEFAULT_STAFF_PASSWORD,
  }));
  app.use('/api/records', createRecordsRouter());
  app.use('/api/meta', createMetaRouter());

  const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
  app.use(staticMiddleware(FRONTEND_DIR));

  app.listen(PORT, () => {
    console.log(`ספריית בית ספר הלל - השרת פועל: http://localhost:${PORT}`);
    console.log(store.getStatus().cloudConfigured ? 'מצב: מחובר ל-Firestore (עם גיבוי מקומי).' : 'מצב: אחסון מקומי בלבד.');
    console.log(
      credentials.getStatus().cloudConfigured
        ? 'סיסמאות: נשמרות ב-Firestore (שורדות פריסה מחדש).'
        : 'סיסמאות: נשמרות רק בקובץ מקומי על השרת.'
    );
  });
}

main().catch((err) => {
  console.error('שגיאה קריטית באתחול השרת:', err);
  process.exit(1);
});
