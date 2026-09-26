// Twilio SMS wrapper. Lazily initialized so requiring this file never
// fails when OTP_PROVIDER isn't 'twilio'.

let client = null;

function getClient(){
  if(client) return client;
  const twilio = require('twilio'); // lazy: don't force this dependency unless OTP_PROVIDER=twilio
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if(!sid || !authToken){
    throw new Error('OTP_PROVIDER=twilio is set but TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are missing — see .env.example.');
  }
  client = twilio(sid, authToken);
  return client;
}

/**
 * Sends the OTP code by SMS to `phone` (10-digit Indian mobile number, no
 * country code — see the app's phoneSchema). Uses Twilio Verify if
 * TWILIO_VERIFY_SERVICE_SID is set (recommended: Twilio generates and
 * checks the code itself, so this app never has to store or compare a
 * code), otherwise falls back to a plain SMS via TWILIO_FROM_NUMBER with
 * the code this app generated.
 */
async function sendOtp(phone, code){
  const c = getClient();
  const to = `+91${phone}`;

  if(process.env.TWILIO_VERIFY_SERVICE_SID){
    await c.verify.v2.services(process.env.TWILIO_VERIFY_SERVICE_SID).verifications.create({ to, channel: 'sms' });
    return { usedVerify: true };
  }

  if(!process.env.TWILIO_FROM_NUMBER){
    throw new Error('Set either TWILIO_VERIFY_SERVICE_SID or TWILIO_FROM_NUMBER — see .env.example.');
  }
  await c.messages.create({ to, from: process.env.TWILIO_FROM_NUMBER, body: `Your Tiffin verification code is ${code}. Valid for 5 minutes.` });
  return { usedVerify: false };
}

/**
 * Only relevant when Twilio Verify is used (see sendOtp above) — Verify
 * checks the code itself rather than this app comparing against a
 * database row. Returns true/false.
 */
async function checkOtp(phone, code){
  const c = getClient();
  const to = `+91${phone}`;
  const result = await c.verify.v2.services(process.env.TWILIO_VERIFY_SERVICE_SID).verificationChecks.create({ to, code });
  return result.status === 'approved';
}

module.exports = { sendOtp, checkOtp };
