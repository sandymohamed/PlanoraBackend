import { OAuth2Client } from "google-auth-library";

const GOOGLE_WEB_CLIENT_ID = process.env.GOOGLE_WEB_CLIENT_ID;

if (!GOOGLE_WEB_CLIENT_ID) {
  throw new Error("GOOGLE_WEB_CLIENT_ID is not configured");
}

const client = new OAuth2Client(GOOGLE_WEB_CLIENT_ID);

export interface GoogleUserPayload {
  googleId: string;
  email: string;
  name: string;
  picture?: string;
}

export async function verifyGoogleIdToken(
  idToken: string,
): Promise<GoogleUserPayload> {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: GOOGLE_WEB_CLIENT_ID,
  });

  const payload = ticket.getPayload();

  if (!payload?.sub || !payload.email) {
    throw new Error("Invalid Google token");
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name || payload.email.split("@")[0],
    picture: payload.picture,
  };
}