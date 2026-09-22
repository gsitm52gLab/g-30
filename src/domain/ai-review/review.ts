import type { HumanReviewCommand } from './types';
import { id, integer, invalid, object, oneOf, text } from './validate';
/** A command shape, not a permission grant or persisted review. Service must authorize/CAS/append atomically. */
export function parseHumanReview(value: unknown): HumanReviewCommand {
  try {
    const v = object(value), decision = oneOf(v.decision, ['accept', 'edit', 'reject']);
    const editedSuggestion = v.editedSuggestion === null ? null : text(v.editedSuggestion, 4000);
    if (decision === 'edit' && !editedSuggestion || decision !== 'edit' && editedSuggestion !== null) invalid();
    return { findingId: id(v.findingId), expectedRevision: integer(v.expectedRevision, 0), decision, reason: text(v.reason, 3000), editedSuggestion };
  } catch { return invalid('REVIEW_INVALID'); }
}
