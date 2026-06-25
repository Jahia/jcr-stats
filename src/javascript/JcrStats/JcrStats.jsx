import React, {useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo} from 'react';
import {useLazyQuery, useMutation, useQuery} from '@apollo/client';
import {useTranslation} from 'react-i18next';
import {Button, Loader, Typography, Bar, Download, Upload} from '@jahia/moonstone';
import {FlameGraph} from 'react-flame-graph';
import styles from './JcrStats.scss';
import {COMPUTE, CANCEL, GET_STATUS, GET_RESULT, GET_EXCLUSIONS, ADD_EXCLUSION, REMOVE_EXCLUSION, GET_SNAPSHOTS, SAVE_SNAPSHOT, DELETE_SNAPSHOT} from './JcrStats.gql';
import {
    formatBytes,
    formatDuration,
    formatTimestamp,
    METRIC_SIZE,
    METRIC_NODES,
    SAVE_FORMAT,
    MAX_IMPORT_BYTES,
    buildJContentUrl,
    extractTree,
    toFlameNode
} from './jcrStatsUtils';
import {TreeTable} from './TreeTable';
import {TopList} from './TopList';
import {DiffTable} from './DiffTable';
import {
    MAX_DEPTH,
    ERROR_COMPUTE,
    ERROR_LOAD,
    ERROR_BASELINE,
    ERROR_SAVE,
    ERROR_DELETE,
    ERROR_EXCLUDE,
    ERROR_UNEXCLUDE,
    SUCCESS_COMPUTED,
    SUCCESS_LOADED,
    SUCCESS_BASELINE,
    SUCCESS_EXCLUDED,
    SUCCESS_UNEXCLUDED,
    SUCCESS_DELETED,
    INFO_CANCELLED,
    INFO_CANCEL_MAYBE,
    INFO_COMPARE_NEEDS_CURRENT,
    ERROR_STATUSES,
    SUCCESS_STATUSES,
    INFO_STATUSES,
    handlePolledStatus,
    readExclusions,
    readSnapshots
} from './jcrStatsController';

const DEFAULT_PATH = '/sites';
const STATUS_POLL_MS = 2000;
const ELAPSED_TICK_MS = 1000;
const BOTTOM_MARGIN = 24;
const MIN_HEIGHT = 320;
const VIEW_FLAMEGRAPH = 'flamegraph';
const VIEW_TABLE = 'table';
const VIEW_LARGEST = 'largest';
const VIEW_DIFF = 'diff';

const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Fetches a stored snapshot's JSON by URL and loads it into the viewer via the same validated
// importer (extractTree) as the file-based Load/Compare. Returns two handlers — load as the current
// tree (View) or as the comparison baseline (Compare) — so two saved executions can be diffed.
// Extracted into a hook to keep the main component's complexity bounded.
const useSnapshotLoader = ({setFocused, setTree, setTreePath, setView, setStatus, setBaseline}) => {
    const fetchSnapshot = useCallback(async url => {
        const response = await fetch(url, {credentials: 'same-origin'});
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const text = await response.text();
        if (text.length > MAX_IMPORT_BYTES) {
            throw new Error('snapshot too large');
        }

        return extractTree(JSON.parse(text));
    }, []);

    const handleViewSnapshot = useCallback(async url => {
        try {
            const {tree: loaded, path: loadedPath} = await fetchSnapshot(url);
            setFocused(null);
            setTreePath(loadedPath);
            setTree(loaded);
            setView(VIEW_FLAMEGRAPH);
            setStatus(SUCCESS_LOADED);
        } catch (err) {
            console.error('[jcr-stats] failed to load snapshot', err);
            setStatus(ERROR_LOAD);
        }
    }, [fetchSnapshot, setFocused, setTree, setTreePath, setView, setStatus]);

    const handleCompareSnapshot = useCallback(async url => {
        try {
            const {tree: loaded} = await fetchSnapshot(url);
            setBaseline(loaded);
            setView(VIEW_DIFF);
            setStatus(SUCCESS_BASELINE);
        } catch (err) {
            console.error('[jcr-stats] failed to load snapshot for comparison', err);
            setStatus(ERROR_BASELINE);
        }
    }, [fetchSnapshot, setBaseline, setView, setStatus]);

    return {handleViewSnapshot, handleCompareSnapshot};
};

// FIX 2 (a11y): deletes a stored execution snapshot via an accessible inline two-step confirmation
// instead of the inaccessible native window.confirm (which has language/focus issues and is silently
// skipped where it is unavailable). The first Delete click records the pending row in
// `confirmingDeletePath`; the row then renders Confirm/Cancel controls and the actual delete runs only
// when Confirm is activated. Extracted into a hook so its try/catch branching does not inflate the
// main component's cyclomatic complexity.
const useSnapshotDeleter = ({deleteSnapshot, refetchSnapshots, setStatus}) => {
    // Path of the snapshot whose row is awaiting delete confirmation (null when none).
    const [confirmingDeletePath, setConfirmingDeletePath] = useState(null);

    // First Delete click: arm the inline confirmation for this row (no destructive action yet).
    const requestDeleteSnapshot = useCallback(snapshotPath => {
        setConfirmingDeletePath(snapshotPath);
    }, []);

    // Cancel: return the row to its normal (un-armed) state.
    const cancelDeleteSnapshot = useCallback(() => {
        setConfirmingDeletePath(null);
    }, []);

    // Confirm: perform the delete, refresh the list and announce success (or surface the error).
    const confirmDeleteSnapshot = useCallback(async snapshotPath => {
        setConfirmingDeletePath(null);
        try {
            const {data} = await deleteSnapshot({variables: {path: snapshotPath}});
            if (data && data.jcrStats && data.jcrStats.deleteSnapshot) {
                await refetchSnapshots();
                setStatus(SUCCESS_DELETED);
            } else {
                setStatus(ERROR_DELETE);
            }
        } catch (err) {
            console.error('[jcr-stats] failed to delete snapshot', err);
            setStatus(ERROR_DELETE);
        }
    }, [deleteSnapshot, refetchSnapshots, setStatus]);

    return {confirmingDeletePath, requestDeleteSnapshot, cancelDeleteSnapshot, confirmDeleteSnapshot};
};

// Exclusion add/remove actions, extracted into a hook so their try/catch branching does not inflate
// the main component's cyclomatic complexity. Each persists server-side and refreshes the list.
const useExclusionActions = ({addExclusion, removeExclusion, refetchExclusions, setStatus}) => {
    const handleExclude = useCallback(async excludedPath => {
        try {
            const {data} = await addExclusion({variables: {path: excludedPath}});
            if (data && data.jcrStats && data.jcrStats.addExclusion) {
                await refetchExclusions();
                setStatus(SUCCESS_EXCLUDED);
            } else {
                setStatus(ERROR_EXCLUDE);
            }
        } catch (err) {
            console.error('[jcr-stats] failed to add exclusion', err);
            setStatus(ERROR_EXCLUDE);
        }
    }, [addExclusion, refetchExclusions, setStatus]);

    const handleRemoveExclusion = useCallback(async excludedPath => {
        try {
            const {data} = await removeExclusion({variables: {path: excludedPath}});
            if (data && data.jcrStats && data.jcrStats.removeExclusion) {
                await refetchExclusions();
                setStatus(SUCCESS_UNEXCLUDED);
            } else {
                setStatus(ERROR_UNEXCLUDE);
            }
        } catch (err) {
            console.error('[jcr-stats] failed to remove exclusion', err);
            setStatus(ERROR_UNEXCLUDE);
        }
    }, [removeExclusion, refetchExclusions, setStatus]);

    return {handleExclude, handleRemoveExclusion};
};

// Computing progress block: spinner, elapsed/count text, indeterminate bar, cancel. Extracted to a
// module-level component to keep the main component's render complexity bounded.
const RunningProgress = ({t, elapsedMs, visitedCount, onCancel}) => {
    const countText = `${visitedCount.toLocaleString()} ${t('label.nodesScanned')}`;
    return (
        <div className={styles.js_running} data-testid="jcrstats-progress">
            {/* M-3 (a11y): give the spinner an accessible name. */}
            <span role="img" aria-label={t('label.computing')}>
                <Loader size="big"/>
            </span>
            <div>
                {/*
                  The visible elapsed/count text updates every 1s tick (or 2s under
                  reduced motion) but is NOT a live region, so AT does not re-announce it.
                */}
                <Typography className={styles.js_running_text}>
                    {`${t('label.computing')} ${formatDuration(elapsedMs)} · ${countText}`}
                </Typography>
                {/*
                  M-2 (a11y): a separate polite live region announcing ONLY the visited count,
                  so it re-announces on the 2s poll boundary (when visitedCount changes), not
                  on the 1s visual tick — avoiding AT spam.
                */}
                <div role="status" aria-live="polite" aria-atomic="true" className={styles.js_sr_only}>
                    {countText}
                </div>
                <div
                    className={styles.js_progress}
                    role="progressbar"
                    aria-label={t('label.computing')}
                    aria-valuetext={countText}
                    aria-valuemin={0}
                    aria-valuemax={100}
                >
                    <div className={styles.js_progress_bar}/>
                </div>
            </div>
            {/* Cancel: requests server-side cancellation (job polls the flag between nodes), then stops watching. */}
            <Button size="default" label={t('label.cancel')} onClick={onCancel}/>
        </div>
    );
};

// Visible banner for error (assertive red), success (polite green, A-12) and info (polite neutral)
// statuses. Returns null otherwise so the main render doesn't carry these branches.
// A-3: only errors are urgent — they use role="alert" (assertive). Info (cancelled/timeout) and
// success are non-urgent and use role="status" (polite) so AT announces them without interrupting.
const StatusBanner = ({t, status}) => {
    if (ERROR_STATUSES.includes(status)) {
        return (
            <div role="alert" className={`${styles.js_alert} ${styles['js_alert--error']}`}>
                {t(`label.${status}`)}
            </div>
        );
    }

    if (SUCCESS_STATUSES.includes(status)) {
        // A-12: a visible success confirmation parallel to the error banner, so sighted users get
        // explicit success feedback (not only the sr-only live region).
        return (
            <div role="status" className={`${styles.js_alert} ${styles['js_alert--success']}`}>
                {t(`label.${status}`)}
            </div>
        );
    }

    if (INFO_STATUSES.includes(status)) {
        return (
            <div role="status" className={`${styles.js_alert} ${styles['js_alert--info']}`}>
                {t(`label.${status}`)}
            </div>
        );
    }

    return null;
};

// Flamegraph view: caption (focused node or root summary + jContent link) and the mouse-only
// react-flame-graph. Extracted to a module-level component to keep the main render's complexity low.
const FlamegraphView = ({t, tree, focused, focusUrl, describeMetric, flameData, dimensions, containerRef, onFocusChange, onExclude}) => {
    const caption = focused ?
        `${t('label.focused')}: ${focused.name} — ${describeMetric(focused.bytes, focused.nodeCount)}` :
        `${tree.name} — ${describeMetric(tree.size, tree.nodeCount)}`;
    return (
        <>
            {/*
              C-1: Keyboard hint visible to all users informing them that the flamegraph is
              mouse-operated and the Tree table is the keyboard-accessible equivalent.
            */}
            <Typography className={styles.js_hint}>{t('label.keyboardHint')}</Typography>
            <Typography className={styles.js_hint}>{t('label.clickHint')}</Typography>
            <div data-testid="jcrstats-flamegraph-caption" className={styles.js_caption}>
                {caption}
                {focusUrl && (
                    /* L-2: opensNewTab appended to aria-label; visible label preserved for Cypress. */
                    <a
                        className={styles.js_focusLink}
                        href={focusUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${t('label.openJContent')} ${t('label.opensNewTab')}`}
                    >
                        {t('label.openJContent')}
                    </a>
                )}
                {focused && focused.path && (
                    /*
                      Exclude the clicked/focused node (and its subtree) from future computations.
                      A-6: js_targetSize guarantees a 44x44 CSS px target (AAA 2.5.5).
                    */
                    <Button
                        size="default"
                        className={styles.js_targetSize}
                        label={t('label.excludePath')}
                        onClick={() => onExclude(focused.path)}
                    />
                )}
            </div>
            {flameData && (
                /*
                  A-5: role="img" + aria-label wraps the mouse-only, non-keyboard-operable flamegraph
                  so AT users get a meaningful single description rather than an unlabelled SVG or a
                  navigable group. The Tree table view is the keyboard-accessible equivalent.
                */
                <div
                    ref={containerRef}
                    data-testid="jcrstats-flamegraph-react"
                    className={styles.js_flamegraph_react}
                    role="img"
                    aria-label={t('label.interactiveTitle')}
                >
                    <FlameGraph data={flameData} height={dimensions.height} width={dimensions.width} onChange={onFocusChange}/>
                </div>
            )}
        </>
    );
};

// Lists the currently-excluded paths with a per-row Remove control. Hidden when there are none.
const ExclusionsPanel = ({t, exclusions, onRemove}) => {
    if (!exclusions.length) {
        return null;
    }

    return (
        <section className={styles.js_exclusions} aria-label={t('label.excludedPaths')}>
            <Typography className={styles.js_label}>{t('label.excludedPaths')}</Typography>
            <Typography className={styles.js_hint}>{t('label.excludeHint')}</Typography>
            <ul className={styles.js_exclusions_list}>
                {exclusions.map(excludedPath => (
                    <li key={excludedPath} className={styles.js_exclusions_item}>
                        <span className={styles.js_exclusions_path}>{excludedPath}</span>
                        {/* A-4: visible label stays compact ("Remove"); aria-label carries the unique path. */}
                        <Button
                            size="default"
                            label={t('label.removeExclusion')}
                            aria-label={t('label.removeExclusionLabel', {path: excludedPath})}
                            onClick={() => onRemove(excludedPath)}
                        />
                    </li>
                ))}
            </ul>
        </section>
    );
};

// Renders one snapshot's human-readable metadata line (E-1): created date + stored size, falling
// back to an "unknown date" label when the server reports no timestamp.
const SnapshotMeta = ({t, snapshot}) => {
    const date = formatTimestamp(snapshot.createdAt) || t('label.snapshotDateUnknown');
    const size = formatBytes(snapshot.size);
    return <span className={styles.js_snapshot_meta}>{t('label.snapshotMeta', {date, size})}</span>;
};

// The per-row action cluster for a saved execution: View, Compare and the Delete control, which
// toggles into an inline two-step confirmation (Confirm/Cancel) instead of a native dialog (FIX 2).
// Extracted so SnapshotsPanel's complexity stays bounded and the focus-management effect is per-row.
const SnapshotActions = ({t, snapshot, isConfirmingDelete, onView, onCompare, onRequestDelete, onConfirmDelete, onCancelDelete}) => {
    // FIX 2: move focus to the Confirm button when the row enters the confirm state, so keyboard/AT
    // users land on the now-primary destructive action rather than being left where the row repainted.
    // Moonstone's Button is a plain function component (no forwardRef), so we focus it by querying the
    // rendered DOM button via a stable data-testid within this row's action container.
    const actionsRef = useRef(null);
    useEffect(() => {
        if (isConfirmingDelete && actionsRef.current) {
            const confirmButton = actionsRef.current.querySelector('[data-testid="jcrstats-snapshot-confirm-delete"]');
            if (confirmButton) {
                confirmButton.focus();
            }
        }
    }, [isConfirmingDelete]);

    if (isConfirmingDelete) {
        return (
            <span ref={actionsRef} className={styles.js_snapshot_actions}>
                <Button
                    data-testid="jcrstats-snapshot-confirm-delete"
                    size="default"
                    color="danger"
                    label={t('label.confirmDeleteSnapshot')}
                    aria-label={t('label.confirmDeleteSnapshotLabel', {name: snapshot.name})}
                    onClick={() => onConfirmDelete(snapshot.path)}
                />
                <Button
                    size="default"
                    variant="ghost"
                    label={t('label.cancelDeleteSnapshot')}
                    aria-label={t('label.cancelDeleteSnapshotLabel', {name: snapshot.name})}
                    onClick={onCancelDelete}
                />
            </span>
        );
    }

    return (
        <span className={styles.js_snapshot_actions}>
            {/* A-4: visible labels stay short; aria-labels carry the unique snapshot name. */}
            <Button
                size="default"
                label={t('label.viewSnapshot')}
                aria-label={t('label.viewSnapshotLabel', {name: snapshot.name})}
                onClick={() => onView(snapshot.url)}
            />
            {/*
              FIX 1 (a11y): Compare is ALWAYS operable and focusable — never disabled — so AT/keyboard
              users can reach it and learn the requirement. The action is gated in onCompare: with no
              current tree it announces an INFO status; otherwise it loads the diff baseline. E-5: the
              subtler "ghost" variant keeps View as the primary action and Compare subordinate.
            */}
            <Button
                size="default"
                variant="ghost"
                label={t('label.compareSnapshot')}
                aria-label={t('label.compareSnapshotLabel', {name: snapshot.name})}
                onClick={() => onCompare(snapshot.url)}
            />
            {/* FIX 2: first click arms the inline confirmation (Confirm/Cancel) instead of deleting. */}
            <Button
                size="default"
                variant="ghost"
                color="danger"
                label={t('label.deleteSnapshot')}
                aria-label={t('label.deleteSnapshotLabel', {name: snapshot.name})}
                onClick={() => onRequestDelete(snapshot.path)}
            />
        </span>
    );
};

// Lists saved execution snapshots (most recent first). Each row has View (load as current tree),
// Compare (load as diff baseline against the current tree) and Delete controls. Hidden when empty.
const SnapshotsPanel = ({t, snapshots, confirmingDeletePath, onView, onCompare, onRequestDelete, onConfirmDelete, onCancelDelete}) => {
    if (!snapshots.length) {
        return null;
    }

    return (
        <section className={styles.js_exclusions} aria-label={t('label.savedExecutions')} data-testid="jcrstats-snapshots">
            <Typography className={styles.js_label}>{t('label.savedExecutions')}</Typography>
            <Typography className={styles.js_hint}>{t('label.snapshotsHint')}</Typography>
            <ul className={styles.js_exclusions_list}>
                {snapshots.map(snapshot => (
                    <li key={snapshot.path} className={styles.js_exclusions_item}>
                        <span className={styles.js_snapshot_main}>
                            <span className={styles.js_exclusions_path}>{snapshot.name}</span>
                            {/* E-1: human-readable date + size beside the bare filename. */}
                            <SnapshotMeta t={t} snapshot={snapshot}/>
                        </span>
                        <SnapshotActions
                            t={t}
                            snapshot={snapshot}
                            isConfirmingDelete={confirmingDeletePath === snapshot.path}
                            onView={onView}
                            onCompare={onCompare}
                            onRequestDelete={onRequestDelete}
                            onConfirmDelete={onConfirmDelete}
                            onCancelDelete={onCancelDelete}
                        />
                    </li>
                ))}
            </ul>
        </section>
    );
};

export const JcrStatsAdmin = () => {
    const {t} = useTranslation('jcr-stats');
    const [path, setPath] = useState(DEFAULT_PATH);
    // E-7: holds the i18n key of the path field error (or null when valid), so the field-level
    // message is actionable and specific (missing vs. not absolute) rather than a single generic one.
    const [pathErrorKey, setPathErrorKey] = useState(null);
    const pathError = pathErrorKey !== null;
    const [metric, setMetric] = useState(METRIC_SIZE);
    const [view, setView] = useState(VIEW_FLAMEGRAPH);
    const [status, setStatus] = useState(null);
    const [focused, setFocused] = useState(null);
    const [tree, setTree] = useState(null);
    const [treePath, setTreePath] = useState(DEFAULT_PATH);
    const [baseline, setBaseline] = useState(null);
    const [computing, setComputing] = useState(false);
    const [visitedCount, setVisitedCount] = useState(0);
    const [, setNowTick] = useState(0);
    const serverElapsedRef = useRef({base: 0, at: 0});
    const pollStartRef = useRef(0);
    // C-2: startedAt of the run we are now watching. Any polled status whose server startedAt is
    // OLDER than this belongs to a previous run and must be ignored (stale-result guard). Updated
    // from the live status as soon as the server reports the new run.
    const runStartedAtRef = useRef(0);
    // C-4: monotonically increasing compute generation. Captured by applyComputedResult so a slow
    // result fetch from a prior run cannot overwrite the state of a newer run (write-after-restart).
    const generationRef = useRef(0);
    const containerRef = useRef(null);
    const fileInputRef = useRef(null);
    // H-5: ref for the results region so focus can be moved to it on view change
    const resultsRegionRef = useRef(null);
    // A-1: set only by handleViewChange so focus moves on an explicit user view switch, NOT when a
    // computation completing programmatically flips the view (which would steal focus without a gesture).
    const viewChangeInitiatedRef = useRef(false);
    // Tracks real unmount so an in-flight result fetch is only discarded when the component is gone —
    // NOT when `computing` flips to false as part of completing the very computation we are reading.
    const isMountedRef = useRef(true);
    const [dimensions, setDimensions] = useState({width: 900, height: 600});

    useEffect(() => () => {
        isMountedRef.current = false;
    }, []);

    useEffect(() => {
        // C-6: the suffix is translatable rather than a hardcoded English string.
        document.title = `${t('label.title')}${t('label.titleSuffix')}`;
    }, [t]);

    const [startCompute] = useMutation(COMPUTE);
    const [cancelComputation] = useMutation(CANCEL);
    const [addExclusion] = useMutation(ADD_EXCLUSION);
    const [removeExclusion] = useMutation(REMOVE_EXCLUSION);
    const [saveSnapshot] = useMutation(SAVE_SNAPSHOT);
    const [deleteSnapshot] = useMutation(DELETE_SNAPSHOT);
    const {data: exclusionsData, refetch: refetchExclusions} = useQuery(GET_EXCLUSIONS, {fetchPolicy: 'network-only'});
    const exclusions = readExclusions(exclusionsData);
    const {handleExclude, handleRemoveExclusion} = useExclusionActions({addExclusion, removeExclusion, refetchExclusions, setStatus});
    const {data: snapshotsData, refetch: refetchSnapshots} = useQuery(GET_SNAPSHOTS, {fetchPolicy: 'network-only'});
    const snapshots = readSnapshots(snapshotsData);
    const {handleViewSnapshot, handleCompareSnapshot} = useSnapshotLoader({setFocused, setTree, setTreePath, setView, setStatus, setBaseline});
    const {confirmingDeletePath, requestDeleteSnapshot, cancelDeleteSnapshot, confirmDeleteSnapshot} =
        useSnapshotDeleter({deleteSnapshot, refetchSnapshots, setStatus});
    // FIX 1 (a11y): the Compare button is always operable; the requirement is gated on the ACTION,
    // not by disabling the control. With no current tree loaded we announce an informational status
    // explaining what to do; otherwise Compare loads the snapshot as the diff baseline (as before).
    const compareSnapshot = useCallback(url => {
        if (!tree) {
            setStatus(INFO_COMPARE_NEEDS_CURRENT);
            return;
        }

        handleCompareSnapshot(url);
    }, [tree, handleCompareSnapshot]);
    // C-1: refresh the saved-execution list only after a SUCCESSFUL computation (a snapshot is
    // auto-saved on completion). Keying on `computing` flipping to false also fired on mount,
    // cancel, timeout and file-load — an over-broad refetch.
    useEffect(() => {
        if (status === SUCCESS_COMPUTED) {
            refetchSnapshots();
        }
    }, [status, refetchSnapshots]);
    const [fetchResult] = useLazyQuery(GET_RESULT, {fetchPolicy: 'network-only'});
    const [fetchStatus] = useLazyQuery(GET_STATUS, {fetchPolicy: 'network-only'});
    // While a computation runs, poll its status; the heavy traversal happens server-side off-request.
    const {data: statusData} = useQuery(GET_STATUS, {
        skip: !computing,
        pollInterval: computing ? STATUS_POLL_MS : 0,
        fetchPolicy: 'network-only'
    });

    const flameData = useMemo(() => (tree ? toFlameNode(tree, metric) : null), [tree, metric]);

    const describeMetric = useCallback((bytes, nodeCount) => (
        metric === METRIC_NODES ? `${nodeCount} ${t('label.nodesUnit')}` : formatBytes(bytes)
    ), [metric, t]);

    const measure = useCallback(() => {
        const el = containerRef.current;
        if (!el) {
            return;
        }

        const {top} = el.getBoundingClientRect();
        const width = el.clientWidth;
        const nextWidth = width > 0 ? width : window.innerWidth;
        const nextHeight = Math.max(MIN_HEIGHT, Math.floor(window.innerHeight - top - BOTTOM_MARGIN));
        setDimensions(prev => (prev.width === nextWidth && prev.height === nextHeight ? prev : {width: nextWidth, height: nextHeight}));
    }, []);

    useLayoutEffect(() => {
        if (!flameData || view !== VIEW_FLAMEGRAPH) {
            return undefined;
        }

        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, [flameData, measure, view]);

    // When the polled status reports the async computation is done, fetch + render the cached result.
    useEffect(() => {
        const current = computing && statusData && statusData.jcrStats && statusData.jcrStats.status;
        if (!current) {
            return undefined;
        }

        if (!isMountedRef.current) {
            return undefined;
        }

        // C-2 (code-quality): cancellation is gated on actual unmount (isMountedRef), not on this
        // effect's teardown — completing the computation flips `computing` to false, which would
        // otherwise tear this effect down and cancel the result fetch we just kicked off.
        const generationAtPoll = generationRef.current;
        handlePolledStatus(current, {
            pollStartMs: pollStartRef.current,
            fetchResult,
            isCancelled: () => !isMountedRef.current,
            // C-2: ignore a status still bearing the previous run's startedAt.
            staleStartedAt: runStartedAtRef.current,
            // C-4: a result fetch is stale once a newer compute generation has begun.
            isStale: () => generationRef.current !== generationAtPoll,
            setters: {
                setComputing,
                setStatus,
                setVisitedCount,
                stop: nextStatus => {
                    setComputing(false);
                    setStatus(nextStatus);
                },
                setRunning: elapsedMs => {
                    serverElapsedRef.current = {base: elapsedMs, at: Date.now()};
                },
                onResult: (computed, resultPath) => {
                    setFocused(null);
                    setTree(computed);
                    setTreePath(resultPath);
                    setView(VIEW_FLAMEGRAPH);
                    setStatus(SUCCESS_COMPUTED);
                }
            }
        });

        return undefined;
    }, [statusData, computing, fetchResult]);

    // Tick while computing so the elapsed timer updates between polls. Under prefers-reduced-motion
    // (L-1 / WCAG 2.3.3) we slow the tick to the poll interval so the time text doesn't change every
    // second, avoiding distracting motion / AT churn.
    useEffect(() => {
        if (!computing) {
            return undefined;
        }

        const interval = prefersReducedMotion() ? STATUS_POLL_MS : ELAPSED_TICK_MS;
        const id = setInterval(() => setNowTick(Date.now()), interval);
        return () => clearInterval(id);
    }, [computing]);

    // On (re)mount, re-read server status so leaving the page and coming back keeps the live status
    // of a still-running computation visible (the polling resumes from the server's elapsed/visited).
    // A *finished* result is intentionally NOT auto-restored: doing so would asynchronously clobber a
    // tree the user has since loaded from a file (race) and surface another user's last run.
    useEffect(() => {
        fetchStatus()
            .then(response => {
                const current = response && response.data && response.data.jcrStats && response.data.jcrStats.status;
                if (current && current.running) {
                    serverElapsedRef.current = {base: Number(current.elapsedMs) || 0, at: Date.now()};
                    pollStartRef.current = Date.now();
                    setVisitedCount(Number(current.visitedCount) || 0);
                    setComputing(true);
                }
            })
            .catch(err => {
                console.error('[jcr-stats] failed to read initial computation status', err);
            });
    }, [fetchStatus]);

    // H-5 / A-1: when the user explicitly switches the view, move focus to the results region so
    // keyboard/AT users land in the new content. Gated on viewChangeInitiatedRef so a programmatic
    // view change (e.g. a computation completing and switching to the flamegraph, or the initial
    // mount) does NOT relocate focus without a user gesture (WCAG 2.2 — no focus change on the
    // completion of an async computation).
    useEffect(() => {
        if (!viewChangeInitiatedRef.current) {
            return;
        }

        viewChangeInitiatedRef.current = false;
        if (resultsRegionRef.current) {
            resultsRegionRef.current.focus();
        }
    }, [view]);

    const handleFocusChange = useCallback(node => {
        if (node) {
            const source = node.source || node;
            setFocused({name: source.name, bytes: source.bytes, nodeCount: source.nodeCount, path: source.nodePath});
        }
    }, []);

    const handleMetricChange = e => {
        setMetric(e.target.value);
        setFocused(null);
    };

    const handleViewChange = e => {
        // A-1: only an explicit user-initiated view change may relocate focus to the results region.
        viewChangeInitiatedRef.current = true;
        setView(e.target.value);
    };

    const handlePathChange = e => {
        setPath(e.target.value);
        if (pathError) {
            setPathErrorKey(null);
        }
    };

    const handlePathKeyDown = e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            handleCompute();
        }
    };

    const openLoadDialog = () => {
        if (fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    const handleCompute = async () => {
        // H-3 (ergonomy): block a blank path instead of silently traversing the whole repo from '/'.
        const targetPath = (path || '').trim();
        if (!targetPath) {
            setPathErrorKey('pathRequired');
            setStatus(null);
            return;
        }

        // E-7: a JCR path is absolute; reject a relative one up front with an actionable message.
        if (!targetPath.startsWith('/')) {
            setPathErrorKey('pathMustBeAbsolute');
            setStatus(null);
            return;
        }

        setPathErrorKey(null);
        setStatus(null);
        setFocused(null);
        setVisitedCount(0);
        // C-2: remember the previous run's startedAt so the poll ignores a stale status still
        // carrying it. C-4: bump the compute generation so a slow prior-run result fetch is dropped.
        const lastStatus = statusData && statusData.jcrStats && statusData.jcrStats.status;
        runStartedAtRef.current = (lastStatus && Number(lastStatus.startedAt)) || 0;
        generationRef.current += 1;
        serverElapsedRef.current = {base: 0, at: Date.now()};
        pollStartRef.current = Date.now();
        try {
            // Fire-and-forget: starts the server-side job (no-op if one is already running),
            // then we poll jcrStats.status and fetch the result when it completes.
            await startCompute({variables: {path: targetPath}});
            setComputing(true);
        } catch (err) {
            console.error('[jcr-stats] failed to start computation', err);
            setStatus(ERROR_COMPUTE);
        }
    };

    // Server-side cancel: ask the server to stop the running job (it polls the flag between nodes),
    // then stop watching. The traversal aborts shortly after; status.cancelled would also reflect it.
    const handleCancel = async () => {
        try {
            await cancelComputation();
            setComputing(false);
            setStatus(INFO_CANCELLED);
        } catch (err) {
            // E-6: the cancel request itself failed, so don't claim the computation was cancelled.
            // Stop watching but warn the user it may still be running on the server.
            console.error('[jcr-stats] failed to cancel computation', err);
            setComputing(false);
            setStatus(INFO_CANCEL_MAYBE);
        }
    };

    const handleSave = () => {
        if (!tree) {
            return;
        }

        const payload = {format: SAVE_FORMAT, version: 1, path: treePath, maxDepth: MAX_DEPTH, exportedAt: new Date().toISOString(), tree};
        const blob = new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const safePath = (treePath || 'root').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        const link = document.createElement('a');
        link.href = url;
        link.download = `jcr-stats-${safePath || 'root'}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    // Read + validate an imported snapshot. errorStatus selects the context-specific message.
    const readFile = (file, onTree, errorStatus) => {
        // H-1 (security): enforce a max file size before reading the whole file into memory.
        if (file.size > MAX_IMPORT_BYTES) {
            console.error('[jcr-stats] import rejected: file too large', file.size);
            setStatus(errorStatus);
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            try {
                const extracted = extractTree(JSON.parse(reader.result));
                if (!extracted) {
                    setStatus(errorStatus);
                    return;
                }

                onTree(extracted);
            } catch (err) {
                console.error('[jcr-stats] failed to read snapshot file', err);
                setStatus(errorStatus);
            }
        };

        reader.onerror = () => {
            console.error('[jcr-stats] FileReader error', reader.error);
            setStatus(errorStatus);
        };

        reader.readAsText(file);
    };

    const handleFileSelected = event => {
        const file = event.target.files && event.target.files[0];
        event.target.value = '';
        if (!file) {
            return;
        }

        readFile(file, ({tree: loaded, path: loadedPath}) => {
            // Show the loaded tree/view immediately, but DEFER the status banner until the save
            // resolves: setting SUCCESS_LOADED up-front would flash a success message that
            // ERROR_SAVE then overwrites on a save failure (a misleading success flash).
            setFocused(null);
            setTreePath(loadedPath);
            setTree(loaded);
            setView(VIEW_FLAMEGRAPH);
            // Persist the loaded data as a server snapshot so it joins the saved-executions history.
            const json = JSON.stringify({format: SAVE_FORMAT, version: 1, path: loadedPath, tree: loaded});
            // C-3: on save failure, surface it (ERROR_SAVE) instead of only console.error while still
            // claiming success; refetch wrapped in an arrow so an Apollo refetch signature change can't
            // pass the resolved snapshot value as refetch variables. SUCCESS_LOADED is set ONLY once the
            // save succeeds, so the success banner never precedes a save error.
            saveSnapshot({variables: {json}})
                .then(({data}) => {
                    if (data && data.jcrStats && data.jcrStats.saveSnapshot) {
                        setStatus(SUCCESS_LOADED);
                        refetchSnapshots();
                    } else {
                        setStatus(ERROR_SAVE);
                    }
                })
                .catch(err => {
                    console.error('[jcr-stats] failed to store loaded snapshot', err);
                    setStatus(ERROR_SAVE);
                });
        }, ERROR_LOAD);
    };

    const focusUrl = focused ? buildJContentUrl(focused.path) : null;
    const isError = ERROR_STATUSES.includes(status);
    const isSuccess = SUCCESS_STATUSES.includes(status);
    const isInfo = INFO_STATUSES.includes(status);

    return (
        <div className={styles.js_container}>
            {/*
              M-3/M-4: Single polite status region for success / info announcements.
              The visible error banner below carries role="alert" so it serves as the
              assertive live region — no duplicate sr-only alert div needed.
            */}
            <div role="status" aria-live="polite" aria-atomic="true" className={styles.js_sr_only}>
                {isSuccess || isInfo ? t(`label.${status}`) : ''}
            </div>

            <div className={styles.js_header}>
                <h2>{t('label.title')}</h2>
            </div>

            <div className={styles.js_description}>
                <Typography>{t('label.description')}</Typography>
            </div>

            {/*
              M-5: Form controls wrapped in a <section> with a sr-only heading so
              landmarks are meaningful to AT users without altering visual layout.
            */}
            <section aria-label={t('label.formRegionLabel')}>
                <div className={styles.js_form}>
                    <label className={styles.js_label} htmlFor="jcrstats-path">{t('label.path')}</label>
                    <input
                        id="jcrstats-path"
                        type="text"
                        className={styles.js_input}
                        value={path}
                        aria-invalid={pathError}
                        aria-describedby={pathError ? 'jcrstats-path-error' : undefined}
                        onChange={handlePathChange}
                        onKeyDown={handlePathKeyDown}
                    />
                    {pathError && (
                        <span id="jcrstats-path-error" role="alert" className={styles.js_fieldError}>
                            {t(`label.${pathErrorKey}`)}
                        </span>
                    )}
                    <label className={styles.js_label} htmlFor="jcrstats-metric">{t('label.metric')}</label>
                    <select id="jcrstats-metric" className={styles.js_select} value={metric} onChange={handleMetricChange}>
                        <option value={METRIC_SIZE}>{t('label.metricSize')}</option>
                        <option value={METRIC_NODES}>{t('label.metricNodes')}</option>
                    </select>
                    <Button size="big" color="accent" icon={<Bar/>} label={t('label.compute')} isDisabled={computing} onClick={handleCompute}/>
                    {/*
                      A-7: the Load button programmatically triggers the sr-only file input; give it an
                      aria-label spelling out its purpose ("Load data — load statistics snapshot file")
                      since the visible "Load data" label alone doesn't announce what it opens.
                      E-8: title explains why it is disabled during a computation.
                    */}
                    <Button
                        size="big"
                        icon={<Upload/>}
                        label={t('label.load')}
                        aria-label={`${t('label.load')} — ${t('label.loadFileLabel')}`}
                        title={computing ? t('label.loadDisabledHint') : undefined}
                        isDisabled={computing}
                        onClick={openLoadDialog}
                    />
                    {/*
                      H-3: Hidden file input is clipped (sr-only) rather than display:none so AT can
                      discover it, with an associated <label>. The Load button triggers it programmatically.
                    */}
                    <label htmlFor="jcrstats-load-input" className={styles.js_sr_only}>
                        {t('label.loadFileLabel')}
                    </label>
                    <input
                        ref={fileInputRef}
                        id="jcrstats-load-input"
                        data-testid="jcrstats-load-input"
                        type="file"
                        accept="application/json,.json"
                        className={styles.js_sr_only}
                        tabIndex={-1}
                        onChange={handleFileSelected}
                    />
                </div>
            </section>

            {computing && (
                <RunningProgress
                    t={t}
                    elapsedMs={serverElapsedRef.current.base + (Date.now() - serverElapsedRef.current.at)}
                    visitedCount={visitedCount}
                    onCancel={handleCancel}
                />
            )}

            {/*
              M-3/M-4: error banner is assertive (role="alert"); info messages (cancel / timeout)
              reuse the same banner with a neutral style. See StatusBanner above.
            */}
            <StatusBanner t={t} status={status}/>

            {!tree && !computing && !isError && (
                <div className={styles.js_empty}>
                    {baseline ? t('label.baselineLoadedHint') : t('label.emptyHint')}
                </div>
            )}

            {/* Saved executions sits ABOVE the results (View) section so the run history is the
                first thing reached after the controls. Returns null when empty, so it adds no
                vertical space until a run has been saved. */}
            <SnapshotsPanel
                t={t}
                snapshots={snapshots}
                confirmingDeletePath={confirmingDeletePath}
                onView={handleViewSnapshot}
                onCompare={compareSnapshot}
                onRequestDelete={requestDeleteSnapshot}
                onConfirmDelete={confirmDeleteSnapshot}
                onCancelDelete={cancelDeleteSnapshot}
            />

            {tree && (
                /*
                  M-5: Results wrapped in a <section> with aria-label.
                  H-5: tabIndex={-1} allows programmatic focus on view change without
                  inserting this container into the natural tab order.
                */
                <section
                    ref={resultsRegionRef}
                    aria-label={t('label.resultsRegionLabel')}
                    tabIndex={-1}
                    className={styles.js_interactive}
                >
                    <div className={styles.js_interactive_head}>
                        <label className={styles.js_label} htmlFor="jcrstats-view">{t('label.view')}</label>
                        <select id="jcrstats-view" className={styles.js_select} value={view} onChange={handleViewChange}>
                            <option value={VIEW_FLAMEGRAPH}>{t('label.viewFlamegraph')}</option>
                            <option value={VIEW_TABLE}>{t('label.viewTable')}</option>
                            <option value={VIEW_LARGEST}>{t('label.viewLargest')}</option>
                            {baseline && <option value={VIEW_DIFF}>{t('label.viewDiff')}</option>}
                        </select>
                        <Button size="default" icon={<Download/>} label={t('label.save')} onClick={handleSave}/>
                    </div>

                    {view === VIEW_FLAMEGRAPH && (
                        <FlamegraphView
                            t={t}
                            tree={tree}
                            focused={focused}
                            focusUrl={focusUrl}
                            describeMetric={describeMetric}
                            flameData={flameData}
                            dimensions={dimensions}
                            containerRef={containerRef}
                            onFocusChange={handleFocusChange}
                            onExclude={handleExclude}
                        />
                    )}

                    {view === VIEW_TABLE && <TreeTable key={treePath} tree={tree} metric={metric}/>}
                    {view === VIEW_LARGEST && <TopList key={treePath} tree={tree} metric={metric}/>}
                    {view === VIEW_DIFF && baseline && <DiffTable baseline={baseline} current={tree}/>}
                </section>
            )}

            {/* Exclusions stays BELOW the results so it never consumes vertical space above the
                flamegraph (which, in a short viewport, would push it past the bottom). */}
            <ExclusionsPanel t={t} exclusions={exclusions} onRemove={handleRemoveExclusion}/>
        </div>
    );
};
