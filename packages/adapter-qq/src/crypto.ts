import { createPrivateKey, sign } from 'node:crypto';

/**
 * Sign the webhook verification response using Ed25519.
 *
 * QQ Bot webhook verification requires:
 * 1. Pad the clientSecret to 32 bytes as the seed
 * 2. Create an Ed25519 private key from the seed
 * 3. Sign the concatenated message (eventTs + plainToken)
 * 4. Return the signature as a hex string
 */
export function signWebhookResponse(
  eventTs: string,
  plainToken: string,
  clientSecret: string,
): string {
  // Pad clientSecret to 32 bytes (Ed25519 seed length)
  const seed = Buffer.alloc(32);
  Buffer.from(clientSecret).copy(seed);

  // Create Ed25519 private key from seed
  // Node.js crypto expects the key in a specific format for Ed25519
  // We need to construct a proper PKCS8 DER format
  const privateKey = createPrivateKey({
    format: 'jwk',
    key: {
      crv: 'Ed25519',
      d: seed.toString('base64url'),
      kty: 'OKP',
      x: '', // Will be derived from d
    },
  });

  // Sign the message
  const message = Buffer.from(eventTs + plainToken);
  const signature = sign(null, message, privateKey);

  return signature.toString('hex');
}
