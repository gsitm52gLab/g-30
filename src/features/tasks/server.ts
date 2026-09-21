import "server-only";
import { identity,currentToken } from "@/server/auth/runtime";
import { TaskService } from "@/server/tasks/service";
import { contextFromSearch,readWorkspace,type Search } from "@/server/workspace";
export async function catalogPage(search:Search){const workspace=await readWorkspace(await contextFromSearch(search));const service=new TaskService(await identity());const token=await currentToken();const catalog=workspace.selected?await service.catalog(token,workspace.selected.id):null;return {workspace,service,token,catalog};}
