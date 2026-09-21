import { createSqliteRepository } from "@/server/repositories/sqlite";
import { openDatabase } from "@/server/db/database";
import { IdentityService } from "@/server/auth/service";
const repo = createSqliteRepository(openDatabase(process.argv[2]));
const service = new IdentityService(repo);
process.send?.({ ready: true, pid: process.pid });
process.once("message", async (message: {
    action: "invite" | "accept";
    token?: string;
    input: Record<string, unknown>;
}) => {
    try {
        const result = message.action === "invite" ? await service.invite(message.token, "ctx-jp-a-luna", message.input) : await service.accept(message.token, message.input);
        process.send?.({ ok: true, result, pid: process.pid });
    }
    catch (error) {
        process.send?.({ ok: false, code: (error as {
                code?: string;
            }).code, pid: process.pid });
    }
    finally {
        repo.close();
        process.disconnect?.();
    }
});
