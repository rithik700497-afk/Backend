// Direct Apple Push Notification service integration — an alternative to
// routing iOS pushes through FCM (src/lib/push/fcm.js). Only use this if
// you specifically don't want Firebase involved for iOS; otherwise FCM's
// unified API is less to maintain. Requires the `apn` package
// (`npm install apn`) — not installed by default since most deployments
// of this app will only need one provider.
//
// Set PUSH_PROVIDER=apns and the APNS_* vars in .env to use this instead
// of fcm.js in notificationService.js.

let provider = null;

function getProvider(){
  if(provider) return provider;
  const apn = require('apn'); // lazy: don't force this dependency unless PUSH_PROVIDER=apns

  const required = ['APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_BUNDLE_ID', 'APNS_KEY_P8_BASE64'];
  const missing = required.filter(k => !process.env[k]);
  if(missing.length){
    throw new Error(`PUSH_PROVIDER=apns is set but missing env vars: ${missing.join(', ')} — see .env.example.`);
  }

  provider = new apn.Provider({
    token: {
      key: Buffer.from(process.env.APNS_KEY_P8_BASE64, 'base64').toString('utf8'),
      keyId: process.env.APNS_KEY_ID,
      teamId: process.env.APNS_TEAM_ID
    },
    production: process.env.APNS_PRODUCTION === 'true'
  });
  return provider;
}

/**
 * Sends `{ title, body }` to every iOS device token in `tokens`. Returns
 * the tokens Apple reported as no-longer-valid, for pruning — same
 * contract as fcm.js's sendToTokens, so notificationService.js can treat
 * either provider identically.
 */
async function sendToTokens(tokens, { title, body }){
  if(!tokens.length) return { invalidTokens: [] };
  const apn = require('apn');
  const p = getProvider();

  const note = new apn.Notification();
  note.alert = { title, body };
  note.topic = process.env.APNS_BUNDLE_ID;
  note.sound = 'default';

  const result = await p.send(note, tokens);
  const invalidTokens = result.failed
    .filter(f => f.response && (f.response.reason === 'BadDeviceToken' || f.response.reason === 'Unregistered'))
    .map(f => f.device);
  return { invalidTokens };
}

module.exports = { sendToTokens };
