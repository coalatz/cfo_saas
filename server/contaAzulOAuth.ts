/**
 * Conta Azul OAuth2 - Authorization Code Flow
 *
 * Endpoints (official docs):
 *   Authorization: https://auth.contaazul.com/login
 *   Token:         https://auth.contaazul.com/oauth2/token
 *
 * Scopes (fixed): openid profile aws.cognito.signin.user.admin
 * access_token TTL: 3600s (1h)
 * refresh_token TTL: 5 years (rotates on every refresh)
 *
 * State encoding strategy:
 *   state = base64url({ tenantId, redirectUri, nonce })
 *   This allows the callback to identify the tenant without extra query params,
 *   which is important because the OAuth provider only returns `code` and `state`.
 */

import axios from "axios";
import { nanoid } from "nanoid";
import { getDb } from "./db";
import { erpConfigs } from "../drizzle/schema";
import { and, eq } from "drizzle-orm";

const AUTHORIZE_URL = "https://auth.contaazul.com/login";
const TOKEN_URL = "https://auth.contaazul.com/oauth2/token";
const SCOPE = "openid profile aws.cognito.signin.user.admin";

export interface ContaAzulCredentials {
  client_id: string;
  client_secret: string;
  base_url?: string;
  access_token?: string;
}

interface StatePayload {
  tenantId: number;
  redirectUri: string;
  nonce: string;
}

function encodeState(payload: StatePayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeState(state: string): StatePayload {
  try {
    return JSON.parse(Buffer.from(state, "base64url").toString("utf-8")) as StatePayload;
  } catch {
    throw new Error("Invalid OAuth state — cannot decode");
  }
}

/**
 * Build the authorization URL to redirect the user to Conta Azul login.
 * The state encodes { tenantId, redirectUri, nonce } so the callback can
 * identify the tenant without extra query parameters.
 */
export async function buildAuthorizeUrl(
  tenantId: number,
  redirectUri: string,
  credentials: ContaAzulCredentials
): Promise<string> {
  const nonce = nanoid(16);
  const statePayload: StatePayload = { tenantId, redirectUri, nonce };
  const state = encodeState(statePayload);

  // Persist the nonce so we can validate it on callback (CSRF protection)
  const db = await getDb();
  if (db) {
    await db
      .update(erpConfigs)
      .set({ oauthState: nonce })
      .where(and(eq(erpConfigs.tenantId, tenantId), eq(erpConfigs.erpType, "conta_azul")));
  }

  const params = new URLSearchParams({
    response_type: "code",
    client_id: credentials.client_id,
    redirect_uri: redirectUri,
    state,
    scope: SCOPE,
  });

  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Exchange the authorization code for access_token + refresh_token.
 * Decodes state to get tenantId + redirectUri, validates nonce, then persists tokens.
 *
 * @param code   - Authorization code from Conta Azul
 * @param state  - Base64url-encoded StatePayload
 * @returns      - { access_token, refresh_token, expires_in, tenantId }
 */
export async function handleCallback(
  code: string,
  state: string
): Promise<{ access_token: string; refresh_token: string; expires_in: number; tenantId: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  // Decode state to get tenantId and redirectUri
  const { tenantId, redirectUri, nonce } = decodeState(state);

  // Fetch stored nonce for CSRF validation
  const rows = await db
    .select()
    .from(erpConfigs)
    .where(and(eq(erpConfigs.tenantId, tenantId), eq(erpConfigs.erpType, "conta_azul")))
    .limit(1);

  const config = rows[0];
  if (!config) throw new Error("ERP config not found for this tenant");
  if (!config.oauthState || config.oauthState !== nonce) {
    throw new Error("OAuth state mismatch — possible CSRF attack or expired flow");
  }

  const credentials = config.credentials as ContaAzulCredentials;
  const basic = Buffer.from(`${credentials.client_id}:${credentials.client_secret}`).toString("base64");

  const body = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  const response = await axios.post<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  }>(TOKEN_URL, body.toString(), {
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  const { access_token, refresh_token, expires_in } = response.data;
  const tokenExpiresAt = new Date(Date.now() + expires_in * 1000);

  // Persist tokens — store access_token inside credentials JSON, refresh_token in dedicated column
  const updatedCredentials: ContaAzulCredentials = { ...credentials, access_token };

  await db
    .update(erpConfigs)
    .set({
      credentials: updatedCredentials,
      refreshToken: refresh_token,
      tokenExpiresAt,
      oauthState: null,  // clear nonce after successful exchange
      status: "active",
    })
    .where(and(eq(erpConfigs.tenantId, tenantId), eq(erpConfigs.erpType, "conta_azul")));

  return { access_token, refresh_token, expires_in, tenantId };
}

/**
 * Refresh the access_token using the stored refresh_token.
 * IMPORTANT: Always save the NEW refresh_token — it rotates on every refresh.
 */
export async function refreshAccessToken(tenantId: number): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const rows = await db
    .select()
    .from(erpConfigs)
    .where(and(eq(erpConfigs.tenantId, tenantId), eq(erpConfigs.erpType, "conta_azul")))
    .limit(1);

  const config = rows[0];
  if (!config) throw new Error("ERP config not found");
  if (!config.refreshToken) throw new Error("No refresh_token stored — user must re-authorize via OAuth");

  const credentials = config.credentials as ContaAzulCredentials;
  const basic = Buffer.from(`${credentials.client_id}:${credentials.client_secret}`).toString("base64");

  const body = new URLSearchParams({
    refresh_token: config.refreshToken,
    grant_type: "refresh_token",
  });

  const response = await axios.post<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }>(TOKEN_URL, body.toString(), {
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  const { access_token, refresh_token, expires_in } = response.data;
  const tokenExpiresAt = new Date(Date.now() + expires_in * 1000);

  const updatedCredentials: ContaAzulCredentials = { ...credentials, access_token };

  // IMPORTANT: always save the NEW refresh_token — it rotates on every refresh
  await db
    .update(erpConfigs)
    .set({
      credentials: updatedCredentials,
      refreshToken: refresh_token,
      tokenExpiresAt,
      status: "active",
    })
    .where(and(eq(erpConfigs.tenantId, tenantId), eq(erpConfigs.erpType, "conta_azul")));

  return access_token;
}

/**
 * Get a valid access_token for a tenant, refreshing automatically if expired or about to expire.
 * Use this in the Extractor Agent instead of reading credentials directly.
 */
export async function getValidAccessToken(tenantId: number): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const rows = await db
    .select()
    .from(erpConfigs)
    .where(and(eq(erpConfigs.tenantId, tenantId), eq(erpConfigs.erpType, "conta_azul")))
    .limit(1);

  const config = rows[0];
  if (!config) throw new Error("ERP config not found");

  const credentials = config.credentials as ContaAzulCredentials;

  // If token is still valid (with 5-minute buffer), return it directly
  if (
    credentials.access_token &&
    config.tokenExpiresAt &&
    config.tokenExpiresAt.getTime() > Date.now() + 5 * 60 * 1000
  ) {
    return credentials.access_token;
  }

  // Token expired or missing — try to refresh
  if (config.refreshToken) {
    return await refreshAccessToken(tenantId);
  }

  throw new Error(
    "No valid access_token and no refresh_token available. User must re-authorize via OAuth."
  );
}

/**
 * Check the OAuth connection status for a tenant.
 */
export async function getOAuthStatus(tenantId: number): Promise<{
  connected: boolean;
  expired: boolean;
  expiresAt: Date | null;
  needsReauth: boolean;
}> {
  const db = await getDb();
  if (!db) return { connected: false, expired: false, expiresAt: null, needsReauth: true };

  const rows = await db
    .select()
    .from(erpConfigs)
    .where(and(eq(erpConfigs.tenantId, tenantId), eq(erpConfigs.erpType, "conta_azul")))
    .limit(1);

  const config = rows[0];
  if (!config) return { connected: false, expired: false, expiresAt: null, needsReauth: true };

  const credentials = config.credentials as ContaAzulCredentials;
  const hasToken = !!credentials.access_token;
  const hasRefresh = !!config.refreshToken;
  const expired = config.tokenExpiresAt ? config.tokenExpiresAt.getTime() < Date.now() : true;

  return {
    connected: hasToken && hasRefresh,
    expired,
    expiresAt: config.tokenExpiresAt ?? null,
    needsReauth: !hasRefresh,
  };
}
