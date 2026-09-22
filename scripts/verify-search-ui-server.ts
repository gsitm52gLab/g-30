import {createServer} from 'node:http';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import next from 'next';
import {fixtures,business} from './verify-search-ui-fixtures';
const mode=process.argv[2] as 'mock'|'sqlite',directory=path.resolve(process.argv[3]);if(!['mock','sqlite'].includes(mode))throw Error('mode');
const {repo}=await fixtures(mode,directory);
if(mode==='sqlite'){repo.close();}else{
 const database=path.join(directory,'data.db');(globalThis as typeof globalThis&{gsHaleRepository?:unknown}).gsHaleRepository={key:`mock:${database}`,pending:Promise.resolve(repo)};
 const port=Number(process.env.E2E_PORT),app=next({dev:false,hostname:'127.0.0.1',port});await app.prepare();const handle=app.getRequestHandler(),server=createServer((req,res)=>{void handle(req,res);});server.listen(port,'127.0.0.1');
 const stop=async()=>{writeFileSync(path.join(directory,'business-after.json'),JSON.stringify(await business(repo),null,2));await app.close();server.close();repo.close();process.exit(0);};process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());
}
