/**
 * BytePlus Visual API V4 signer — HMAC-SHA256, same shape as Volcengine V4.
 *
 * Usage:
 *   const resp = await byteplusVisualCall({
 *     action: "CVSubmitTask",
 *     body: { req_key: "...", image_url: "..." },
 *   });
 *
 * Env:
 *   BYTEPLUS_ACCESS_KEY_ID
 *   BYTEPLUS_SECRET_ACCESS_KEY
 *
 * Host/region derived from the BytePlus Python SDK (cv.byteplusapi.com / ap-singapore-1).
 */

import { createHash, createHmac } from "node:crypto";
import "dotenv/config";

const HOST = "cv.byteplusapi.com";
const REGION = "ap-singapore-1";
const SERVICE = "cv";
const API_VERSION = "2024-06-06";
const ALGORITHM = "HMAC-SHA256";

function hex(buf: Buffer) {
  return buf.toString("hex");
}
function sha256Hex(input: string | Buffer) {
  return hex(createHash("sha256").update(input).digest());
}
function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}
function getSigningKey(sk: string, date: string, region: string, service: string) {
  const kDate = hmac(sk, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "request");
}
function fmtDate(d: Date) {
  // YYYYMMDDTHHMMSSZ
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}
function encodeRFC3986(s: string) {
  // RFC 3986 strict encoding (used in canonical query)
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}
function normQuery(q: Record<string, string>) {
  return Object.keys(q)
    .sort()
    .map((k) => `${encodeRFC3986(k)}=${encodeRFC3986(q[k])}`)
    .join("&");
}

export interface ByteplusCallArgs {
  action: string;          // e.g. "CVSubmitTask"
  version?: string;         // defaults to API_VERSION
  body: unknown;            // JSON body
}

export interface ByteplusResponse<T = unknown> {
  code: number;             // 10000 on success
  message?: string;
  data?: T;
  status?: number;
  request_id?: string;
}

export async function byteplusVisualCall<T = unknown>({
  action,
  version = API_VERSION,
  body,
}: ByteplusCallArgs): Promise<ByteplusResponse<T>> {
  const ak = process.env.BYTEPLUS_ACCESS_KEY_ID;
  const sk = process.env.BYTEPLUS_SECRET_ACCESS_KEY;
  if (!ak || !sk) throw new Error("BYTEPLUS_ACCESS_KEY_ID / BYTEPLUS_SECRET_ACCESS_KEY not set in env");

  const bodyStr = JSON.stringify(body ?? {});
  const bodyHash = sha256Hex(bodyStr);

  const xDate = fmtDate(new Date());
  const date = xDate.slice(0, 8);

  const query: Record<string, string> = { Action: action, Version: version };
  const canonicalQuery = normQuery(query);

  // Signed headers: host, content-type, x-content-sha256, x-date
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Host: HOST,
    "X-Content-Sha256": bodyHash,
    "X-Date": xDate,
  };

  // Canonical-header lines: "lowered_key:value\n", sorted by lowered key
  const signedHeaderKeys = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort();
  const canonicalHeaders =
    signedHeaderKeys
      .map((lk) => {
        const origKey = Object.keys(headers).find((k) => k.toLowerCase() === lk)!;
        return `${lk}:${headers[origKey]}`;
      })
      .join("\n") + "\n";
  const signedHeaders = signedHeaderKeys.join(";");

  const canonicalRequest = [
    "POST",
    "/",
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    bodyHash,
  ].join("\n");

  const credentialScope = `${date}/${REGION}/${SERVICE}/request`;
  const stringToSign = [ALGORITHM, xDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");

  const signingKey = getSigningKey(sk, date, REGION, SERVICE);
  const signature = hex(hmac(signingKey, stringToSign));

  const authorization = `${ALGORITHM} Credential=${ak}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `https://${HOST}/?${canonicalQuery}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...headers, Authorization: authorization },
    body: bodyStr,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`BytePlus ${action} HTTP ${res.status}: ${text}`);
  }
  return JSON.parse(text) as ByteplusResponse<T>;
}
