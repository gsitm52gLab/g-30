export class WorkbookInputError extends Error {
    constructor(public code: string) { super(code); }
}
export function inputError(code: string): never { throw new WorkbookInputError(code); }
