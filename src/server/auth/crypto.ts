import { randomBytes, createHash, scrypt, timingSafeEqual } from "node:crypto";
import type { CredentialData } from "@/domain/records";
export const digestToken = (value: string) => createHash("sha256").update(value).digest("hex");
export const randomToken = () => randomBytes(32).toString("base64url");
function derive(password: string, salt: string): Promise<Buffer> { return new Promise((resolve, reject) => scrypt(password, Buffer.from(salt, "hex"), 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key))); }
export async function hashPassword(password: string, userId: string): Promise<CredentialData> { const salt = randomBytes(16).toString("hex"); return { userId, scheme: "scrypt-v1", salt, digest: (await derive(password, salt)).toString("hex") }; }
export async function verifyPassword(password: string, credential?: CredentialData) {
    const calculated = await derive(password, credential?.salt ?? "00000000000000000000000000000000");
    const expected = Buffer.from(credential?.digest ?? "00".repeat(64), "hex");
    return expected.length === calculated.length && timingSafeEqual(calculated, expected) && !!credential;
}
