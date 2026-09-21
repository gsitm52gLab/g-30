import "server-only";
import { cookies } from "next/headers";
import { getRepository } from "@/server/repositories";
import { IdentityService } from "./service";
export function authConfig() { const origin = process.env.APP_ORIGIN || "http://127.0.0.1:3000"; const url = new URL(origin); if (!["http:", "https:"].includes(url.protocol) || url.pathname !== "/" || url.search || url.hash)
    throw new Error("APP_ORIGIN 설정을 확인해 주세요."); const cookieName = process.env.SESSION_COOKIE_NAME || `gs_hale_${url.port || url.protocol.slice(0, -1)}`; if (!/^[a-zA-Z0-9_-]{1,80}$/.test(cookieName))
    throw new Error("SESSION_COOKIE_NAME 설정을 확인해 주세요."); return { origin: url.origin, cookieName, secure: url.protocol === "https:" }; }
export async function currentToken() { return (await cookies()).get(authConfig().cookieName)?.value; }
export async function identity() { return new IdentityService(await getRepository()); }
