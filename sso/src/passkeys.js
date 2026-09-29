// Passkeys (WebAuthn): add a passkey from the account page, then sign in with
// Face ID / fingerprint / the device PIN — no password.
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { HttpError, json, readJson, now, randomToken, utf8, rateLimit, clientIp } from './lib.js';

const CHALLENGE_TTL = 5 * 60;

let schemaReady = false;
export async function ensurePasskeySchema(env) {
  if (schemaReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS passkeys (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      public_key TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0, transports TEXT NOT NULL DEFAULT '[]',
      name TEXT NOT NULL DEFAULT '', device_type TEXT, backed_up INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, last_used_at INTEGER)`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS passkeys_user ON passkeys(user_id)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS webauthn_challenges (
      id TEXT PRIMARY KEY, challenge TEXT NOT NULL, user_id TEXT, type TEXT NOT NULL, expires_at INTEGER NOT NULL)`),
  ]);
  schemaReady = true;
}

// The passkey belongs to "reembir.com", so it keeps working on any *.reembir.com page.
function relyingParty(request, env) {
  const origin = env.PUBLIC_URL || new URL(request.url).origin;
  const host = new URL(origin).hostname;
  const rpID = env.RP_ID || (host === 'reembir.com' || host.endsWith('.reembir.com') ? 'reembir.com' : host);
  return { origin, rpID };
}

function guessDeviceName(request) {
  const ua = request.headers.get('user-agent') || '';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Passkey';
}

async function saveChallenge(env, challenge, type, userId) {
  const id = randomToken(16);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM webauthn_challenges WHERE expires_at < ?').bind(now()),
    env.DB.prepare('INSERT INTO webauthn_challenges (id, challenge, user_id, type, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, challenge, userId, type, now() + CHALLENGE_TTL),
  ]);
  return id;
}

async function takeChallenge(env, id, type) {
  const row = await env.DB.prepare('SELECT * FROM webauthn_challenges WHERE id = ? AND type = ?').bind(String(id || ''), type).first();
  await env.DB.prepare('DELETE FROM webauthn_challenges WHERE id = ?').bind(String(id || '')).run();
  if (!row || row.expires_at < now()) throw new HttpError(400, 'challenge_expired', 'עבר יותר מדי זמן, נסו שוב');
  return row;
}

// ---------- account page (signed in) ----------

export async function listPasskeys(request, env, h) {
  const user = await h.requirePortalUser(request, env);
  await ensurePasskeySchema(env);
  const { results } = await env.DB.prepare(
    'SELECT id, name, device_type, backed_up, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at',
  ).bind(user.id).all();
  return json({ passkeys: results.map(p => ({ ...p, backed_up: !!p.backed_up })) });
}

export async function registerOptions(request, env, h) {
  const user = await h.requirePortalUser(request, env);
  await ensurePasskeySchema(env);
  const { rpID } = relyingParty(request, env);
  const { results } = await env.DB.prepare('SELECT id, transports FROM passkeys WHERE user_id = ?').bind(user.id).all();
  const options = await generateRegistrationOptions({
    rpName: 'reem.bi',
    rpID,
    userID: utf8(user.id),
    userName: user.email,
    userDisplayName: user.name || user.email,
    attestationType: 'none',
    excludeCredentials: results.map(r => ({ id: r.id, transports: JSON.parse(r.transports || '[]') })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  });
  const challengeId = await saveChallenge(env, options.challenge, 'reg', user.id);
  return json({ challengeId, options });
}

export async function registerVerify(request, env, h) {
  const user = await h.requirePortalUser(request, env);
  await ensurePasskeySchema(env);
  const body = await readJson(request);
  const ch = await takeChallenge(env, body.challengeId, 'reg');
  if (ch.user_id !== user.id) throw new HttpError(400, 'challenge_mismatch', 'נסו שוב');
  const { origin, rpID } = relyingParty(request, env);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: ch.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch (err) {
    throw new HttpError(400, 'passkey_failed', 'לא הצלחנו לאמת את ה-Passkey: ' + err.message);
  }
  if (!verification.verified) throw new HttpError(400, 'passkey_failed', 'לא הצלחנו לאמת את ה-Passkey');

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const name = String(body.name || '').trim().slice(0, 40) || guessDeviceName(request);
  await env.DB.prepare(
    `INSERT INTO passkeys (id, user_id, public_key, counter, transports, name, device_type, backed_up, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    credential.id, user.id, isoBase64URL.fromBuffer(credential.publicKey), credential.counter,
    JSON.stringify(credential.transports || body.response?.response?.transports || []),
    name, credentialDeviceType || null, credentialBackedUp ? 1 : 0, now(),
  ).run();
  return listPasskeys(request, env, h);
}

export async function renamePasskey(request, env, h, id) {
  const user = await h.requirePortalUser(request, env);
  await ensurePasskeySchema(env);
  const body = await readJson(request);
  const name = String(body.name || '').trim().slice(0, 40);
  if (!name) throw new HttpError(400, 'bad_name', 'חסר שם');
  await env.DB.prepare('UPDATE passkeys SET name = ? WHERE id = ? AND user_id = ?').bind(name, id, user.id).run();
  return listPasskeys(request, env, h);
}

export async function deletePasskey(request, env, h, id) {
  const user = await h.requirePortalUser(request, env);
  await ensurePasskeySchema(env);
  await env.DB.prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  return listPasskeys(request, env, h);
}

// ---------- sign in ----------

export async function loginOptions(request, env) {
  await ensurePasskeySchema(env);
  await rateLimit(env, `passkey-ip:${clientIp(request)}`, 60, 600);
  const { rpID } = relyingParty(request, env);
  // No allowCredentials: the device offers whichever passkeys it has for reembir.com.
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred' });
  const challengeId = await saveChallenge(env, options.challenge, 'auth', null);
  return json({ challengeId, options });
}

export async function loginVerify(request, env, h) {
  await ensurePasskeySchema(env);
  const body = await readJson(request);
  const ch = await takeChallenge(env, body.challengeId, 'auth');
  const credId = String(body.response?.id || '');
  const cred = await env.DB.prepare('SELECT * FROM passkeys WHERE id = ?').bind(credId).first();
  if (!cred) throw new HttpError(400, 'passkey_unknown', 'ה-Passkey הזה כבר לא מקושר לאף חשבון. היכנסו בדרך אחרת ואפשר להוסיף אותו מחדש.');
  const { origin, rpID } = relyingParty(request, env);

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: ch.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: cred.id,
        publicKey: isoBase64URL.toBuffer(cred.public_key),
        counter: cred.counter,
        transports: JSON.parse(cred.transports || '[]'),
      },
      requireUserVerification: false,
    });
  } catch (err) {
    throw new HttpError(400, 'passkey_failed', 'הכניסה עם Passkey נכשלה: ' + err.message);
  }
  if (!verification.verified) throw new HttpError(400, 'passkey_failed', 'הכניסה עם Passkey נכשלה');

  await env.DB.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?')
    .bind(verification.authenticationInfo.newCounter, now(), cred.id).run();
  const user = await h.getUserById(env, cred.user_id);
  if (!user) throw new HttpError(400, 'passkey_unknown', 'החשבון לא נמצא');
  return h.completeLogin(request, env, user);
}
