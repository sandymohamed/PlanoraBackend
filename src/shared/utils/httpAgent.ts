import https from 'https';

/**
 * Node on Windows / corporate networks may fail TLS with UNABLE_TO_VERIFY_LEAF_SIGNATURE
 * for OpenAI and other HTTPS APIs. In development, skip verification unless explicitly enabled.
 */
export function createDevHttpsAgent(): https.Agent | undefined {
  const strict =
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === '1' ||
    process.env.OPENAI_TLS_REJECT_UNAUTHORIZED === 'true';

  if (process.env.NODE_ENV === 'production' || strict) {
    return undefined;
  }

  return new https.Agent({ rejectUnauthorized: false });
}
