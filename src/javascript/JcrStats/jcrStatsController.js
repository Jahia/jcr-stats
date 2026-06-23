// Safely reads the exclusions array out of the GET_EXCLUSIONS response. Null-safe so a short-circuit
// chain doesn't add to the main component's cyclomatic complexity.
export const readExclusions = data => (data && data.jcrStats && data.jcrStats.exclusions) || [];

// Likewise for the saved-execution snapshot list.
export const readSnapshots = data => (data && data.jcrStats && data.jcrStats.snapshots) || [];

// Pure, React-free controllers + constants for the async-computation status polling flow. Kept in
// their own module (no React/Apollo/moonstone imports) so they can be unit-tested under jest's
// `node` test environment, and so the JcrStatsAdmin arrow's cyclomatic complexity stays bounded.

export const MAX_DEPTH = 6;
export const MAX_POLL_MS = 10 * 60 * 1000; // Stop watching a job after ~10 min

// Status kinds for the alert / live region. Errors are distinct per failure path so the
// message is actionable; successes track which action completed for an accurate announcement.
export const ERROR_COMPUTE = 'errorCompute';
export const ERROR_LOAD = 'errorLoad';
export const ERROR_BASELINE = 'errorBaseline';
export const ERROR_SAVE = 'errorSave';
export const ERROR_DELETE = 'errorDelete';
export const ERROR_EXCLUDE = 'errorExclude';
export const ERROR_UNEXCLUDE = 'errorUnexclude';
export const SUCCESS_COMPUTED = 'success';
export const SUCCESS_LOADED = 'successLoaded';
export const SUCCESS_BASELINE = 'successBaseline';
export const SUCCESS_EXCLUDED = 'successExcluded';
export const SUCCESS_UNEXCLUDED = 'successUnexcluded';
export const SUCCESS_DELETED = 'successDeleted';
export const INFO_CANCELLED = 'infoCancelled';
export const INFO_CANCEL_MAYBE = 'infoCancelMaybe';
export const INFO_TIMEOUT = 'infoTimeout';

export const ERROR_STATUSES = [
    ERROR_COMPUTE, ERROR_LOAD, ERROR_BASELINE, ERROR_SAVE, ERROR_DELETE, ERROR_EXCLUDE, ERROR_UNEXCLUDE
];
export const SUCCESS_STATUSES = [
    SUCCESS_COMPUTED, SUCCESS_LOADED, SUCCESS_BASELINE, SUCCESS_EXCLUDED, SUCCESS_UNEXCLUDED, SUCCESS_DELETED
];
export const INFO_STATUSES = [INFO_CANCELLED, INFO_CANCEL_MAYBE, INFO_TIMEOUT];

// Read the freshly-computed result and hand it to the supplied setters, guarded by isCancelled
// (real unmount) and isStale (a newer compute generation started) so an overlapping poll + result
// fetch can't apply a stale result.
export const applyComputedResult = (fetchResult, statusPath, handlers) => {
    const {isCancelled, isStale, onResult, onError} = handlers;
    // C-4: isStale() reflects whether the compute generation has advanced since this fetch was
    // kicked off; if so a newer run has started and this (slow) result must not overwrite its state.
    const stale = () => typeof isStale === 'function' && isStale();
    return fetchResult({variables: {maxDepth: MAX_DEPTH}})
        .then(response => {
            if (isCancelled() || stale()) {
                return;
            }

            const computed = response && response.data && response.data.jcrStats && response.data.jcrStats.result;
            if (computed) {
                onResult(computed, statusPath);
            } else {
                onError();
            }
        })
        .catch(err => {
            if (isCancelled() || stale()) {
                return;
            }

            console.error('[jcr-stats] failed to fetch computation result', err);
            onError();
        });
};

// Drive one polled-status update. Returns true when the caller should register the result-fetch
// cancellation cleanup (i.e. a fetch was kicked off), false otherwise. All side effects go through
// the `ctx` setters so this stays a pure-ish controller, keeping the effect arrow's complexity low.
export const handlePolledStatus = (current, ctx) => {
    const {pollStartMs, fetchResult, isCancelled, setters, staleStartedAt} = ctx;

    // C-2: when a NEW run is started, the skipped GET_STATUS query may still hold the PREVIOUS
    // run's status object (running:false, hasResult:true). Applying it would immediately surface
    // the old result for the new run. The server stamps each run with a distinct startedAt, so a
    // status still bearing the previous run's startedAt is stale — ignore it and keep polling until
    // the server reports the new run's startedAt.
    const serverStartedAt = Number(current.startedAt) || 0;
    if (staleStartedAt && serverStartedAt && serverStartedAt === staleStartedAt) {
        return false;
    }

    if (pollStartMs && (Date.now() - pollStartMs) > MAX_POLL_MS) {
        setters.stop(INFO_TIMEOUT);
        return false;
    }

    setters.setVisitedCount(Number(current.visitedCount) || 0);

    if (current.running) {
        setters.setRunning(Number(current.elapsedMs) || 0);
        return false;
    }

    if (current.cancelled) {
        // Server job stopped because cancellation was requested — a clean stop, not an error.
        setters.stop(INFO_CANCELLED);
        return false;
    }

    if (current.error) {
        setters.stop(ERROR_COMPUTE);
        return false;
    }

    if (!current.hasResult) {
        setters.stop(ERROR_COMPUTE);
        return false;
    }

    setters.setComputing(false);
    applyComputedResult(fetchResult, current.path, {
        isCancelled,
        isStale: ctx.isStale,
        onResult: setters.onResult,
        onError: () => setters.setStatus(ERROR_COMPUTE)
    });
    return true;
};
