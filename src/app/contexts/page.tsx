import { identity, currentToken } from "@/server/auth/runtime";
import { workspaceFailure } from "@/server/workspace";
import { StorageFailure } from "@/components/workspace";
import { ContextManager } from "@/features/contexts/manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "컨텍스트·회원" };
export default async function Contexts() {
    const data = await (await (async () => { const service = await identity(); return (await service.me(await currentToken())); })()).catch(workspaceFailure);
    if (!data)
        return <StorageFailure />;
    return <ContextManager initial={data}/>;
}
