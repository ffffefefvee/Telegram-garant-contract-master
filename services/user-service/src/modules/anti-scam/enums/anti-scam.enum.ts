/**
 * Lifecycle of a scammer record.
 *
 * REPORTED  — at least one valid complaint exists, not yet enough to flag.
 * CONFIRMED — flagged as scammer (auto by reporter threshold OR manual by moderator),
 *             evidence already posted to the evidence channel, awaiting DB-channel batch.
 * PUBLISHED — included into the public scam DB channel batch.
 * REJECTED  — moderator dismissed the record; treated as clean.
 */
export enum ScammerStatus {
  REPORTED = 'reported',
  CONFIRMED = 'confirmed',
  PUBLISHED = 'published',
  REJECTED = 'rejected',
}

/**
 * Lifecycle of a single complaint.
 *
 * PENDING  — awaiting moderation / counting towards the auto-confirm threshold.
 * APPROVED — accepted by a moderator (or auto-accepted on confirm).
 * REJECTED — dismissed by a moderator.
 */
export enum ScamReportStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

/** How a scammer record reached CONFIRMED status. */
export enum ScamConfirmationSource {
  /** Reached the distinct-reporter threshold automatically. */
  AUTO_THRESHOLD = 'auto_threshold',
  /** Manually confirmed by a moderator/admin. */
  MANUAL = 'manual',
}
