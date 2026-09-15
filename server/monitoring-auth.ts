import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "./http";

const COOKIE = "namepass_monitoring_session";
const STATE_COOKIE = "namepass_monitoring_oauth_state";
const SESSION_SECONDS = 60 * 60 * 12;

function config() {
	const clientId = process.env.MONITORING_GITHUB_CLIENT_ID;
	const clientSecret = process.env.MONITORING_GITHUB_CLIENT_SECRET;
	const secret = process.env.MONITORING_SESSION_SECRET;
	const users = (process.env.MONITORING_GITHUB_USERS ?? "")
		.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
	if (!clientId || !clientSecret || !secret || secret.length < 32 || users.length !== 2 || new Set(users).size !== 2) {
		throw new ApiError(503, "monitoring_auth_unconfigured", "Developer dashboard access is not configured.");
	}
	return { clientId, clientSecret, secret, users };
}

function sign(value: string, secret: string) {
	return createHmac("sha256", secret).update(value).digest("base64url");
}

function cookie(name: string, value: string, maxAge: number) {
	return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function readCookie(request: Request, name: string) {
	return request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
}

export function githubLogin(request: Request) {
	const { clientId, secret } = config();
	const state = crypto.randomUUID();
	const redirect = new URL("/api/auth/github/callback", request.url).toString();
	const location = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirect)}&scope=read:user&state=${encodeURIComponent(state)}`;
	return new Response(null, { status: 302, headers: { location, "cache-control": "no-store", "set-cookie": cookie(STATE_COOKIE, `${state}.${sign(state, secret)}`, 600) } });
}

export async function githubCallback(request: Request) {
	const { clientId, clientSecret, secret, users } = config();
	const url = new URL(request.url);
	const state = url.searchParams.get("state");
	const code = url.searchParams.get("code");
	const expected = readCookie(request, STATE_COOKIE)?.split(".");
	if (!state || !code || !expected || expected.length !== 2 || expected[0] !== state || !safeEqual(expected[1], sign(state, secret))) {
		throw new ApiError(400, "invalid_oauth_state", "The GitHub sign-in session expired. Try again.");
	}
	const tokenResponse = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: new URL("/api/auth/github/callback", request.url).toString() }) });
	const token = await tokenResponse.json() as { access_token?: string };
	if (!tokenResponse.ok || !token.access_token) throw new ApiError(401, "github_token_failed", "GitHub sign-in failed.");
	const userResponse = await fetch("https://api.github.com/user", { headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token.access_token}`, "user-agent": "namepass-monitoring" } });
	const user = await userResponse.json() as { login?: string; id?: number };
	if (!userResponse.ok || !user.login || !Number.isSafeInteger(user.id) || !users.includes(user.login.toLowerCase())) throw new ApiError(403, "developer_not_allowed", "Access denied.");
	const payload = `${user.login}:${user.id}:${Math.floor(Date.now() / 1000)}`;
	const session = `${payload}.${sign(payload, secret)}`;
	const headers = new Headers({ location: "/monitoring", "cache-control": "no-store" });
	headers.append("set-cookie", cookie(COOKIE, session, SESSION_SECONDS));
	headers.append("set-cookie", cookie(STATE_COOKIE, "", 0));
	return new Response(null, { status: 302, headers });
}

function safeEqual(a: string, b: string) {
	const left = Buffer.from(a); const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}

export function monitoringSession(request: Request) {
	const { secret, users } = config();
	const raw = readCookie(request, COOKIE);
	const separator = raw?.lastIndexOf(".") ?? -1;
	if (!raw || separator < 1) return null;
	const payload = raw.slice(0, separator);
	const signature = raw.slice(separator + 1);
	if (!safeEqual(signature, sign(payload, secret))) return null;
	const parts = payload.split(":");
	if (parts.length !== 3) return null;
	const issued = Number(parts[2]);
	if (!Number.isSafeInteger(issued) || issued > Date.now() / 1000 || Date.now() / 1000 - issued >= SESSION_SECONDS || !users.includes(parts[0].toLowerCase())) return null;
	return { login: parts[0] };
}

export function requireMonitoringSession(request: Request) {
	const session = monitoringSession(request);
	if (!session) throw new ApiError(401, "monitoring_auth_required", "GitHub sign-in is required.");
	return session;
}

export function logout() {
	return new Response(null, { status: 302, headers: { location: "/monitoring", "set-cookie": cookie(COOKIE, "", 0) } });
}

export { COOKIE };
