// Firebase Cloud Messaging wrapper. FCM is the recommended default here
// because it delivers to Android, iOS, AND web with one API and one set
// of credentials — a direct APNs integration (src/lib/push/apns.js) is
// only worth the extra setup if you specifically don't want Firebase in
// the loop for iOS.
//
// Lazily initialized so requiring this file never fails when
// PUSH_PROVIDER isn't 'fcm' — only the first real send attempts init,
// and that's wrapped in a clear error if credentials are missing.

let app = null;

function getApp(){
  if(app) return app;
  const admin = require('firebase-admin'); // required lazily: don't force this dependency on deployments that don't use FCM

  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if(!raw){
    throw new Error('PUSH_PROVIDER=fcm is set but FCM_SERVICE_ACCOUNT_JSON is missing — see .env.example.');
  }
  // FCM_SERVICE_ACCOUNT_JSON holds the full service-account JSON, either
  // as raw JSON or base64-encoded (base64 is friendlier for most host
  // dashboards' single-line env var inputs).
  const json = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const serviceAccount = JSON.parse(json);

  app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  return app;
}

/**
 * Sends `{ title, body }` to every token in `tokens`. Returns the list of
 * tokens FCM reported as invalid/unregistered, so the caller can prune
 * them from the DeviceToken table — a stale token left in place just
 * fails forever and wastes a send on every future notification.
 */
async function sendToTokens(tokens, { title, body }, data = {}){
  if(!tokens.length) return { invalidTokens: [] };
  const admin = require('firebase-admin');
  getApp();

  const message = {
    tokens,
    notification: { title, body },
    data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])) // FCM data payloads must be string-valued
  };

  const result = await admin.messaging().sendEachForMulticast(message);
  const invalidTokens = [];
  result.responses.forEach((r, i) => {
    if(!r.success){
      const code = r.error && r.error.code;
      if(code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token'){
        invalidTokens.push(tokens[i]);
      }
    }
  });
  return { invalidTokens };
}

module.exports = { sendToTokens };
