import "server-only";
import { parseConfig, parseStorageConfig, parseAiConfig } from "./parse";
// Next loads .env in its runtime. This module must never be imported by a client component.
export function readServerConfig() { return parseConfig(process.env); }
export function readStorageConfig() { return parseStorageConfig(process.env); }
export function readAiConfig() { return parseAiConfig(process.env); }
