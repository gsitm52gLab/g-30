/** Deployment-owned allowlist. A filename, client checkbox or claimed license never grants transfer. */
export const SYNTHETIC_TEXT = '合成テスト：肌を清潔に保ちます。実在の商品ではありません。';
const hashes=new Set([
 'c97215f31dfa97b0358a6b557b7cd70a44cdd1fc432b5e6f1a3e7e37af1d11a8',
 '098ab1117eaabf545150123784593efb6a92a3452dfe0fa684afb5171d984b2b',
 'c98e83c9bf401a03bdf6a2c1df5ba2f7ebc516cc17c4a99e622b6c40d01e705a',
]);
import { contentHash } from './extraction';
hashes.add(contentHash(SYNTHETIC_TEXT));
export function provenance(sha256:string):'synthetic'|'unknown'{return hashes.has(sha256)?'synthetic':'unknown';}
