// MSG91 OTP wrapper — a common choice for Indian-number SMS delivery
// (often cheaper/faster-routed than Twilio for Indian carriers). Uses
// MSG91's own OTP API, which — like Twilio Verify — generates and
// verifies the code on their side, so this app never stores or compares
// a code for this path either. Uses the platform's global fetch (Node 18+),
// no extra dependency needed.

const BASE_URL = 'https://control.msg91.com/api/v5/otp';

function requireEnv(){
  const authKey = process.env.MSG91_AUTH_KEY;
  const templateId = process.env.MSG91_TEMPLATE_ID;
  if(!authKey || !templateId){
    throw new Error('OTP_PROVIDER=msg91 is set but MSG91_AUTH_KEY / MSG91_TEMPLATE_ID are missing — see .env.example.');
  }
  return { authKey, templateId };
}

async function sendOtp(phone){
  const { authKey, templateId } = requireEnv();
  const mobile = `91${phone}`;
  const url = `${BASE_URL}?template_id=${encodeURIComponent(templateId)}&mobile=${mobile}&authkey=${encodeURIComponent(authKey)}`;
  const res = await fetch(url, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if(data.type !== 'success'){
    throw new Error(`MSG91 send failed: ${data.message || res.status}`);
  }
}

async function checkOtp(phone, code){
  const { authKey } = requireEnv();
  const mobile = `91${phone}`;
  const url = `${BASE_URL}/verify?mobile=${mobile}&otp=${encodeURIComponent(code)}&authkey=${encodeURIComponent(authKey)}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  return data.type === 'success';
}

module.exports = { sendOtp, checkOtp };
