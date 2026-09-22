import data from './curated.json';
import { createCorpusRelease } from './corpus';
/** Minimal, explicitly unreviewed deployment proposal. This does not publish a database release. */
export function curatedRelease() { return createCorpusRelease(data); }
