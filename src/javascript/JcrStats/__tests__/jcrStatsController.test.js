import {
    handlePolledStatus,
    applyComputedResult,
    readExclusions,
    readSnapshots,
    MAX_POLL_MS,
    ERROR_COMPUTE,
    SUCCESS_COMPUTED,
    INFO_CANCELLED,
    INFO_TIMEOUT
} from '../jcrStatsController.js';

describe('readExclusions / readSnapshots null-safety', () => {
    it('readExclusions returns [] for null / undefined / missing nesting', () => {
        expect(readExclusions(null)).toEqual([]);
        expect(readExclusions(undefined)).toEqual([]);
        expect(readExclusions({})).toEqual([]);
        expect(readExclusions({jcrStats: {}})).toEqual([]);
    });

    it('readExclusions returns the array when present', () => {
        expect(readExclusions({jcrStats: {exclusions: ['/a', '/b']}})).toEqual(['/a', '/b']);
    });

    it('readSnapshots returns [] for null / undefined / missing nesting', () => {
        expect(readSnapshots(null)).toEqual([]);
        expect(readSnapshots(undefined)).toEqual([]);
        expect(readSnapshots({})).toEqual([]);
        expect(readSnapshots({jcrStats: {}})).toEqual([]);
    });

    it('readSnapshots returns the list when present', () => {
        const list = [{path: '/s/1', name: '1', url: 'u', createdAt: 1, size: 2}];
        expect(readSnapshots({jcrStats: {snapshots: list}})).toBe(list);
    });
});

// Build a setters object whose every member is a jest.fn(), so each branch's side effect is
// observable. `stop` and `setRunning`/`onResult` mirror the wiring in JcrStatsAdmin.
const makeSetters = () => ({
    setComputing: jest.fn(),
    setStatus: jest.fn(),
    setVisitedCount: jest.fn(),
    stop: jest.fn(),
    setRunning: jest.fn(),
    onResult: jest.fn()
});

// A fetchResult stub resolving to a given result (or rejecting), matching Apollo's lazy-query shape.
const fetchResultResolving = result => jest.fn(() => Promise.resolve({data: {jcrStats: {result}}}));

describe('handlePolledStatus', () => {
    const baseCtx = overrides => ({
        pollStartMs: Date.now(),
        fetchResult: fetchResultResolving({name: 'root'}),
        isCancelled: () => false,
        isStale: () => false,
        staleStartedAt: 0,
        setters: makeSetters(),
        ...overrides
    });

    it('stops with INFO_TIMEOUT once the poll has run past MAX_POLL_MS', () => {
        const ctx = baseCtx({pollStartMs: Date.now() - (MAX_POLL_MS + 1000)});
        const result = handlePolledStatus({running: true, visitedCount: 5}, ctx);
        expect(result).toBe(false);
        expect(ctx.setters.stop).toHaveBeenCalledWith(INFO_TIMEOUT);
    });

    it('ignores a stale status still bearing the previous run startedAt', () => {
        const ctx = baseCtx({staleStartedAt: 1000});
        const result = handlePolledStatus({running: false, hasResult: true, startedAt: 1000}, ctx);
        expect(result).toBe(false);
        // No setters fired — the stale status was dropped before any side effect.
        expect(ctx.setters.setVisitedCount).not.toHaveBeenCalled();
        expect(ctx.setters.setComputing).not.toHaveBeenCalled();
    });

    it('processes a status whose startedAt differs from the stale value', () => {
        const ctx = baseCtx({staleStartedAt: 1000});
        const result = handlePolledStatus({running: true, startedAt: 2000, visitedCount: 3}, ctx);
        expect(result).toBe(false);
        expect(ctx.setters.setRunning).toHaveBeenCalled();
    });

    it('updates the visited count on every processed status', () => {
        const ctx = baseCtx();
        handlePolledStatus({running: true, visitedCount: 42}, ctx);
        expect(ctx.setters.setVisitedCount).toHaveBeenCalledWith(42);
    });

    it('reports running by calling setRunning with the elapsed ms (no completion)', () => {
        const ctx = baseCtx();
        const result = handlePolledStatus({running: true, elapsedMs: 1234, visitedCount: 1}, ctx);
        expect(result).toBe(false);
        expect(ctx.setters.setRunning).toHaveBeenCalledWith(1234);
        expect(ctx.setters.setComputing).not.toHaveBeenCalled();
    });

    it('stops with INFO_CANCELLED when the server reports the run was cancelled', () => {
        const ctx = baseCtx();
        const result = handlePolledStatus({running: false, cancelled: true}, ctx);
        expect(result).toBe(false);
        expect(ctx.setters.stop).toHaveBeenCalledWith(INFO_CANCELLED);
    });

    it('stops with ERROR_COMPUTE when the server reports an error', () => {
        const ctx = baseCtx();
        const result = handlePolledStatus({running: false, error: 'boom'}, ctx);
        expect(result).toBe(false);
        expect(ctx.setters.stop).toHaveBeenCalledWith(ERROR_COMPUTE);
    });

    it('stops with ERROR_COMPUTE when the run is done but no result is available', () => {
        const ctx = baseCtx();
        const result = handlePolledStatus({running: false, hasResult: false}, ctx);
        expect(result).toBe(false);
        expect(ctx.setters.stop).toHaveBeenCalledWith(ERROR_COMPUTE);
    });

    it('on success: clears computing, kicks off the result fetch and returns true', async () => {
        const fetchResult = fetchResultResolving({name: 'root', size: 10, nodeCount: 1});
        const ctx = baseCtx({fetchResult});
        const result = handlePolledStatus({running: false, hasResult: true, path: '/sites'}, ctx);
        expect(result).toBe(true);
        expect(ctx.setters.setComputing).toHaveBeenCalledWith(false);
        expect(fetchResult).toHaveBeenCalled();
        // Let the fetch promise resolve so onResult fires with the path.
        await Promise.resolve();
        await Promise.resolve();
        expect(ctx.setters.onResult).toHaveBeenCalledWith({name: 'root', size: 10, nodeCount: 1}, '/sites');
    });
});

describe('applyComputedResult', () => {
    const handlers = overrides => ({
        isCancelled: () => false,
        isStale: () => false,
        onResult: jest.fn(),
        onError: jest.fn(),
        ...overrides
    });

    it('calls onResult with the computed tree + path on success', async () => {
        const fetchResult = fetchResultResolving({name: 'r', size: 1, nodeCount: 1});
        const h = handlers();
        await applyComputedResult(fetchResult, '/p', h);
        expect(h.onResult).toHaveBeenCalledWith({name: 'r', size: 1, nodeCount: 1}, '/p');
        expect(h.onError).not.toHaveBeenCalled();
    });

    it('calls onError when the response carries no result', async () => {
        const fetchResult = fetchResultResolving(null);
        const h = handlers();
        await applyComputedResult(fetchResult, '/p', h);
        expect(h.onError).toHaveBeenCalled();
        expect(h.onResult).not.toHaveBeenCalled();
    });

    it('calls onError when the fetch rejects', async () => {
        const fetchResult = jest.fn(() => Promise.reject(new Error('network')));
        const h = handlers();
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        await applyComputedResult(fetchResult, '/p', h);
        expect(h.onError).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('does nothing when isCancelled() is true at resolve time (unmount guard)', async () => {
        const fetchResult = fetchResultResolving({name: 'r', size: 1, nodeCount: 1});
        const h = handlers({isCancelled: () => true});
        await applyComputedResult(fetchResult, '/p', h);
        expect(h.onResult).not.toHaveBeenCalled();
        expect(h.onError).not.toHaveBeenCalled();
    });

    it('does nothing when isStale() is true at resolve time (newer-run guard, C-4)', async () => {
        const fetchResult = fetchResultResolving({name: 'r', size: 1, nodeCount: 1});
        const h = handlers({isStale: () => true});
        await applyComputedResult(fetchResult, '/p', h);
        expect(h.onResult).not.toHaveBeenCalled();
        expect(h.onError).not.toHaveBeenCalled();
    });

    it('treats SUCCESS_COMPUTED as the status the component applies on a real result', () => {
        // Sanity check on the shared constant the controller and component agree on.
        expect(SUCCESS_COMPUTED).toBe('success');
    });
});
