import type { IdentityService } from '@/server/auth/service';
import { FileService } from '@/server/files/service';
import { unavailable } from '@/server/auth/errors';
import { resolveCampaign } from './access';
import { versionDTO } from './projection';
import { exactReference } from './targets';
import * as safe from './stored';
export class CampaignFileService {
    constructor(private identity: IdentityService, private files = new FileService(identity)) { }
    private async reference(token: string | undefined, versionId: string, submissionId: string, fileId: string) {
        return this.identity.repo.transaction(async (s) => {
            const p = (await this.identity.principal(s, token)), v = (await s.get('campaignVersion', versionId));
            if (!v)
                unavailable();
            (await resolveCampaign(s, p, v.data.campaignId, this.identity.clock));
            (await versionDTO(s, p, v, this.identity.clock));
            const refs = [...(await s.list('campaignPhysicalFact', v.contextId!)).filter(r => r.data.campaignVersionId === v.id).flatMap(r => safe.physical(r.data).evidence), ...(await s.list('campaignFollowupFact', v.contextId!)).filter(r => r.data.campaignVersionId === v.id).map(r => safe.submitted(r.data.source))];
            const ref = refs.find(x => x.submissionId === submissionId && x.fileVersionIds.includes(fileId));
            if (!ref)
                unavailable();
            (await exactReference(s, p, ref, this.identity.clock));
            return v.data.taskId;
        });
    }
    async download(token: string | undefined, fileId: string, versionId: string, submissionId: string, mode: 'original' | 'download' | 'preview') {
        const taskId = await this.reference(token, versionId, submissionId, fileId), result = await this.files.download(token, fileId, taskId, mode);
        await this.reference(token, versionId, submissionId, fileId);
        return result;
    }
}
