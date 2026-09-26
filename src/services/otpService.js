const prisma = require('../lib/prisma');

const OTP_TTL_MINUTES = 5;

function generateCode(){
  return String(Math.floor(1000 + Math.random() * 9000)); // 4 digits, matches the frontend's OTP screen
}

// Twilio Verify and MSG91's OTP API both generate AND check the code on
// their own side (see src/lib/sms/*.js) — this app never sees or stores
// that code for those paths. Twilio's plain-SMS fallback (no
// TWILIO_VERIFY_SERVICE_SID set) is the one path where this app still
// generates the code and stores it in OtpCode, same as dev mode.
function usesProviderSideVerification(){
  if(process.env.OTP_PROVIDER === 'msg91') return true;
  if(process.env.OTP_PROVIDER === 'twilio' && process.env.TWILIO_VERIFY_SERVICE_SID) return true;
  return false;
}

/**
 * Sends (or, in dev mode, simulates sending) an OTP to `phone`, and stores
 * it for later verification (unless the provider verifies on its own
 * side — see usesProviderSideVerification above).
 *
 * DEV MODE (default, when OTP_PROVIDER is unset): no real SMS is sent —
 * the code is returned in the response so the app is fully testable with
 * zero external accounts, mirroring the frontend's own honest "Demo mode"
 * banner rather than pretending to text something that never arrives.
 *
 * LIVE MODE: set OTP_PROVIDER to 'twilio' or 'msg91' in .env and fill in
 * the matching credentials (see .env.example and src/lib/sms/*.js).
 */
async function requestOtp(phone){
  const provider = process.env.OTP_PROVIDER;

  if(!provider){
    const code = generateCode();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
    await prisma.otpCode.create({ data: { phone, code, expiresAt } });
    return { sent: true, devCode: code };
  }

  if(provider === 'twilio'){
    const twilio = require('../lib/sms/twilio');
    const code = generateCode();
    const { usedVerify } = await twilio.sendOtp(phone, code);
    if(!usedVerify){
      // Plain-SMS fallback path: this app generated the code, so it has
      // to store it to check later, same as dev mode.
      const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
      await prisma.otpCode.create({ data: { phone, code, expiresAt } });
    }
    return { sent: true };
  }

  if(provider === 'msg91'){
    const msg91 = require('../lib/sms/msg91');
    await msg91.sendOtp(phone);
    return { sent: true };
  }

  throw new Error(`OTP_PROVIDER="${provider}" is not a recognized provider — supported: "twilio", "msg91". See src/services/otpService.js.`);
}

async function verifyOtp(phone, code){
  if(usesProviderSideVerification()){
    const provider = process.env.OTP_PROVIDER === 'msg91' ? require('../lib/sms/msg91') : require('../lib/sms/twilio');
    const ok = await provider.checkOtp(phone, code);
    return ok ? { ok: true } : { ok: false, reason: 'invalid_or_expired_code' };
  }

  const otp = await prisma.otpCode.findFirst({
    where: { phone, code, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' }
  });
  if(!otp) return { ok: false, reason: 'invalid_or_expired_code' };
  await prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
  return { ok: true };
}

module.exports = { requestOtp, verifyOtp };
