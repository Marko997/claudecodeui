// @ts-nocheck -- web-push does not provide declarations in this project.
import webPush from 'web-push';

import { getConnection } from '../database/index.js';

let cachedKeys = null;
const db = getConnection();

function ensureVapidKeys() {
  if (cachedKeys) return cachedKeys;

  const row = db.prepare('SELECT public_key, private_key FROM vapid_keys ORDER BY id DESC LIMIT 1').get();
  if (row) {
    cachedKeys = { publicKey: row.public_key, privateKey: row.private_key };
    return cachedKeys;
  }

  const keys = webPush.generateVAPIDKeys();
  db.prepare('INSERT INTO vapid_keys (public_key, private_key) VALUES (?, ?)').run(keys.publicKey, keys.privateKey);
  cachedKeys = keys;
  return cachedKeys;
}

function getPublicKey() {
  return ensureVapidKeys().publicKey;
}

/**
 * VAPID `sub` claim: a contact for whoever is sending the pushes.
 *
 * Apple's push service validates this claim and rejects unroutable domains
 * with 403 BadJwtToken — a `.local` address fails there while WNS and FCM
 * accept it, so iOS is the only platform that silently gets no notifications.
 * The default is a real domain for that reason; override it with
 * VAPID_SUBJECT (a mailto: address or an https:// URL) to point at your own
 * contact.
 */
const DEFAULT_VAPID_SUBJECT = 'mailto:noreply@cloudcli.ai';

function resolveVapidSubject() {
  const configured = process.env.VAPID_SUBJECT?.trim();
  if (!configured) {
    return DEFAULT_VAPID_SUBJECT;
  }
  if (!/^(mailto:|https:\/\/)/.test(configured)) {
    console.warn(
      `[WebPush] Ignoring VAPID_SUBJECT "${configured}": must start with "mailto:" or "https://".`
    );
    return DEFAULT_VAPID_SUBJECT;
  }
  return configured;
}

function configureWebPush() {
  const keys = ensureVapidKeys();
  const subject = resolveVapidSubject();
  webPush.setVapidDetails(
    subject,
    keys.publicKey,
    keys.privateKey
  );
  console.log(`Web Push notifications configured (subject: ${subject})`);
}

export { ensureVapidKeys, getPublicKey, configureWebPush };
