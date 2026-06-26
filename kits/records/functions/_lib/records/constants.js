// Read-path limits for the records kit, centralized here so the caps aren't
// buried as bare literals inside the query builders and the read handler.
//
// These run inside a serverless function, so they're backstopped by the
// platform's 1MB function-response cap: a page that serializes over 1MB fails
// with a clear "Response too large" error instead of truncating silently. Pick
// generous caps here so apps don't paginate small/medium datasets prematurely.

export const LIST_DEFAULT_LIMIT = 100;   // action=list: default page size
export const LIST_MAX_LIMIT = 10000;     // action=list: hard cap

export const ACTIVITY_DEFAULT_LIMIT = 50; // action=activity: default feed size
export const ACTIVITY_MAX_LIMIT = 100;    // action=activity: hard cap

export const RECORD_EVENTS_LIMIT = 50;    // action=get: audit events returned with one record
export const OBJECT_EVENTS_LIMIT = 100;   // action=events: audit events returned for one object
