import type { IdentityService } from '@/server/auth/service';
import { FileService, sourceReference } from '@/server/files/service';
import { fail, unavailable } from '@/server/auth/errors';
import { externalDTO } from './projection';
export class CompletionFiles {
    constructor(public identity: IdentityService, private directory?: string) { }
    async download(token: string | undefined, id: string, query: URLSearchParams) {
        if ([...query.keys()].some(k => !['externalActionId', 'mode'].includes(k) || query.getAll(k).length !== 1))
            fail('VALIDATION', 422, '전달 기록과 정확한 파일 버전을 선택해 주세요.');
        const actionId = query.get('externalActionId'), mode = query.get('mode') ?? 'download';
        if (!actionId || !['download', 'preview', 'original'].includes(mode))
            fail('VALIDATION', 422, '전달 기록과 정확한 파일 버전을 선택해 주세요.');
        const authorize = () => this.identity.repo.transaction(s => { const p = this.identity.principal(s, token), row = s.get('completionExternalAction', actionId); if (!row)
            unavailable(); const action = externalDTO(s, p, row, this.identity.clock); if (!action.source.fileVersionIds.includes(id) && !action.evidenceFiles.some(f => f.id === id))
            unavailable(); const file = s.get('fileVersion', id); if (!file)
            unavailable(); return sourceReference(file); });
        const reference = await authorize(), result = await new FileService(this.identity, this.directory).download(token, id, reference, mode as 'download' | 'preview' | 'original');
        await authorize();
        return result;
    }
}
