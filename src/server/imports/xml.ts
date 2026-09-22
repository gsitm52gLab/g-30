import { SaxesParser, type SaxesTagNS } from 'saxes';
import { importLimits as limits } from '@/domain/imports/types';
import { inputError } from './xml-errors';
export const namespaces = {
    main: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    relationship: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    package: 'http://schemas.openxmlformats.org/package/2006/relationships',
    content: 'http://schemas.openxmlformats.org/package/2006/content-types',
    xml: 'http://www.w3.org/XML/1998/namespace',
    xmlns: 'http://www.w3.org/2000/xmlns/',
} as const;
export type XmlTag = SaxesTagNS;
export function xmlAttribute(tag: XmlTag, local: string, uri = '') {
    return Object.values(tag.attributes).find(a => a.local === local && a.uri === uri)?.value ?? null;
}
export function expectedRoot(filename: string) {
    if (/\.rels$/i.test(filename)) return { local: 'Relationships', uri: namespaces.package };
    if (filename === '[Content_Types].xml') return { local: 'Types', uri: namespaces.content };
    const local = filename === 'xl/workbook.xml' ? 'workbook' : filename === 'xl/styles.xml' ? 'styleSheet' : filename === 'xl/sharedStrings.xml' ? 'sst' : /^xl\/worksheets\/[^/]+\.xml$/.test(filename) ? 'worksheet' : null;
    return local ? { local, uri: namespaces.main } : null;
}
const escapeText = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\r', '&#xD;');
const escapeAttribute = (text: string) => escapeText(text).replaceAll('"', '&quot;').replaceAll('\t', '&#x9;').replaceAll('\n', '&#xA;').replaceAll('\r', '&#xD;');
function decoded(bytes: Buffer) {
    try {
        const encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
        return new TextDecoder(encoding, { fatal: true }).decode(bytes);
    } catch { inputError('OOXML_INVALID'); }
}
interface Hooks {
    open?: (tag: XmlTag, parents: readonly XmlTag[]) => void;
    text?: (text: string, parents: readonly XmlTag[]) => void;
    close?: (tag: XmlTag, parents: readonly XmlTag[]) => void;
}
/** Namespace processing is shared by original-byte guards and decoder input. No DTD/network/entity resolver. */
export function inspectXml(filename: string, bytes: Buffer, hooks: Hooks = {}, canonical = false): Buffer {
    const parser = new SaxesParser({ xmlns: true }), stack: XmlTag[] = [], expected = expectedRoot(filename);
    const output: string[] = [], names: string[] = [], bindings: Map<string, string>[] = [];
    const prefixes = new Map<string, string>([[namespaces.relationship, 'r'], [namespaces.xml, 'xml']]);
    let outputBytes = 0, generated = 0, rootSeen = false;
    const append = (text: string) => { if (!canonical) return; outputBytes += Buffer.byteLength(text); if (outputBytes > limits.entryBytes) inputError('RESOURCE_LIMIT'); output.push(text); };
    const alias = (uri: string) => { if (!prefixes.has(uri)) prefixes.set(uri, `hale${++generated}`); return prefixes.get(uri)!; };
    parser.on('error', () => inputError('OOXML_INVALID'));
    parser.on('doctype', () => inputError('ACTIVE_CONTENT_UNSUPPORTED'));
    parser.on('opentag', tag => {
        if (stack.length >= 128) inputError('RESOURCE_LIMIT');
        // Match expanded element/attribute names. Text mentioning these words is inert.
        if (/^oleObjects?$/i.test(tag.local)) inputError('ACTIVE_CONTENT_UNSUPPORTED');
        if (filename === '[Content_Types].xml' && ['Default', 'Override'].includes(tag.local) && /(?:macroEnabled|vbaProject|oleObject)/i.test(xmlAttribute(tag, 'ContentType') ?? '')) inputError('ACTIVE_CONTENT_UNSUPPORTED');
        if ((tag.uri === namespaces.package || /\.rels$/i.test(filename)) && tag.local === 'Relationship') {
            const type = xmlAttribute(tag, 'Type') ?? '';
            if (/\/(?:vbaProject|oleObject|externalLink|externalLinkPath)$/.test(type)) inputError('ACTIVE_CONTENT_UNSUPPORTED');
            if (xmlAttribute(tag, 'TargetMode')?.toLowerCase() === 'external' && !/\/hyperlink$/.test(type)) inputError('EXTERNAL_CONNECTION_UNSUPPORTED');
        }
        if (canonical && expected) {
            if (!rootSeen && (tag.uri !== expected.uri || tag.local !== expected.local)) inputError('OOXML_INVALID');
            const structural = expected.uri === namespaces.main ? ['workbook', 'sheets', 'sheet', 'worksheet', 'sheetData', 'row', 'c', 'sst', 'si', 'styleSheet'] : expected.uri === namespaces.package ? ['Relationships', 'Relationship'] : ['Types', 'Default', 'Override'];
            const cellValue = ['f', 'v', 't'].includes(tag.local) && stack.some(p => p.uri === namespaces.main && ['c', 'si', 'is'].includes(p.local));
            if ((structural.includes(tag.local) || cellValue) && tag.uri !== expected.uri) inputError('OOXML_INVALID');
        }
        rootSeen = true;
        hooks.open?.(tag, stack);
        if (canonical) {
            const scope = new Map(bindings.at(-1) ?? [['xml', namespaces.xml]]), declarations = new Map<string, string>();
            const bind = (prefix: string, uri: string) => { if (scope.get(prefix) !== uri) { scope.set(prefix, uri); declarations.set(prefix, uri); } };
            const name = (local: string, uri: string, attribute = false) => {
                if (!uri) { if (!attribute) bind('', ''); return local; }
                if (!attribute && uri === expected?.uri) { bind('', uri); return local; }
                const prefix = alias(uri); bind(prefix, uri); return `${prefix}:${local}`;
            };
            const qname = name(tag.local, tag.uri), attributes = Object.values(tag.attributes).filter(a => a.uri !== namespaces.xmlns).map(a => `${name(a.local, a.uri, true)}="${escapeAttribute(a.value)}"`);
            append(`<${qname}${[...declarations].map(([prefix, uri]) => ` xmlns${prefix ? `:${prefix}` : ''}="${escapeAttribute(uri)}"`).join('')}${attributes.length ? ' ' + attributes.join(' ') : ''}>`);
            names.push(qname); bindings.push(scope);
        }
        stack.push(tag);
    });
    const text = (value: string) => { hooks.text?.(value, stack); append(escapeText(value)); };
    parser.on('text', text); parser.on('cdata', text);
    parser.on('closetag', tag => { hooks.close?.(tag, stack); stack.pop(); if (canonical) { append(`</${names.pop()!}>`); bindings.pop(); } });
    parser.write(decoded(bytes)).close();
    if (!rootSeen) inputError('OOXML_INVALID');
    return canonical ? Buffer.from(output.join('')) : bytes;
}
