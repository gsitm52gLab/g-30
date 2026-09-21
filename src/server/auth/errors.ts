export class AuthError extends Error {
    constructor(public code: string, public status: number, message: string) {
        super(message);
        this.name = "AuthError";
    }
}

export function fail(code: string, status: number, message: string): never {
    throw new AuthError(code, status, message);
}

/** One response for absent resources and resources outside the caller's scope. */
export function unavailable(): never {
    return fail("NOT_FOUND", 404, "자료를 찾을 수 없습니다.");
}
