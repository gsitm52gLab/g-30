import yauzl from 'yauzl';
import { crc32 } from 'node:zlib';
import { importLimits as limits } from '@/domain/imports/types';
export class WorkbookInputError extends Error {
    constructor(public code: string) { super(code); }
}
export function inputError(code: string): never { throw new WorkbookInputError(code); }
/** Read bounded ZIP members in memory; never extract uploaded paths or follow relationships. */
export function guardedZip(bytes: Buffer): Promise<Map<string, Buffer>> {
    if (bytes.length > limits.inputBytes || bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50)
        inputError('XLSX_REQUIRED');
    return new Promise((resolve, reject) => yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
        if (error || !zip) {
            reject(new WorkbookInputError('ZIP_INVALID'));
            return;
        }
        let count = 0, total = 0, settled = false;
        const result = new Map<string, Buffer>(), names = new Set<string>();
        const stop = (e: unknown) => { if (!settled) {
            settled = true;
            zip.close();
            reject(e instanceof WorkbookInputError ? e : new WorkbookInputError('ZIP_INVALID'));
        } };
        zip.on('error', stop);
        zip.on('end', () => { if (!settled) {
            settled = true;
            resolve(result);
        } });
        zip.on('entry', entry => {
            try {
                const name: string = entry.fileName, canonical = name.normalize('NFC').toLowerCase();
                if (++count > limits.entries || name.startsWith('/') || name.includes('\\') || name.split('/').some(x => x === '..' || x === '.') || /^[a-z]:/i.test(name) || /%(?:2f|5c|2e)/i.test(name) || names.has(canonical))
                    inputError('ZIP_PATH_INVALID');
                names.add(canonical);
                if (entry.generalPurposeBitFlag & 1 || ![0, 8].includes(entry.compressionMethod))
                    inputError('ZIP_UNSUPPORTED');
                if (entry.uncompressedSize > limits.entryBytes || total + entry.uncompressedSize > limits.totalBytes)
                    inputError('RESOURCE_LIMIT');
                if (/\/$/.test(name)) {
                    zip.readEntry();
                    return;
                }
                if (/(?:vbaProject|externalLinks\/|embeddings\/|connections\.xml|queryTables\/|activeX\/)/i.test(name))
                    inputError('ACTIVE_CONTENT_UNSUPPORTED');
                zip.openReadStream(entry, (streamError, stream) => {
                    if (streamError || !stream) {
                        stop(streamError);
                        return;
                    }
                    let size = 0, crc = 0;
                    const chunks: Buffer[] = [];
                    stream.on('error', stop);
                    stream.on('data', (chunk: Buffer) => { size += chunk.length; total += chunk.length; if (size > limits.entryBytes || total > limits.totalBytes) {
                        stream.destroy();
                        stop(new WorkbookInputError('RESOURCE_LIMIT'));
                        return;
                    } crc = crc32(chunk, crc); chunks.push(chunk); });
                    stream.on('end', () => {
                        if (settled)
                            return;
                        if (size !== entry.uncompressedSize || crc !== entry.crc32) {
                            stop(new WorkbookInputError('ZIP_INTEGRITY'));
                            return;
                        }
                        const data = Buffer.concat(chunks);
                        if (/\.(?:xml|rels)$/i.test(name)) {
                            const xml = data.toString('utf8');
                            if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(xml) || /(?:macroEnabled|vbaProject|oleObject)/i.test(xml)) {
                                stop(new WorkbookInputError('ACTIVE_CONTENT_UNSUPPORTED'));
                                return;
                            }
                            if (/\.rels$/i.test(name) && [...xml.matchAll(/<Relationship\b[^>]*\/?\s*>/g)].some(([tag]) => /TargetMode\s*=\s*["']External["']/i.test(tag) && !/(?:\/hyperlink)["']/i.test(tag))) {
                                stop(new WorkbookInputError('EXTERNAL_CONNECTION_UNSUPPORTED'));
                                return;
                            }
                        }
                        result.set(name, data);
                        zip.readEntry();
                    });
                });
            }
            catch (e) {
                stop(e);
            }
        });
        zip.readEntry();
    }));
}
export function attribute(tag: string, name: string): string | null { return new RegExp(`(?:^|\\s)${name}=["']([^"']*)["']`).exec(tag)?.[1] ?? null; }
