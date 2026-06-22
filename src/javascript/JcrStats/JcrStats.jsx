import React, {useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo} from 'react';
import {useLazyQuery, useMutation, useQuery} from '@apollo/client';
import {useTranslation} from 'react-i18next';
import {Button, Loader, Typography, Bar, Download, Upload, Compare} from '@jahia/moonstone';
import {FlameGraph} from 'react-flame-graph';
import styles from './JcrStats.scss';
import {COMPUTE, GET_STATUS, GET_RESULT} from './JcrStats.gql';
import {
    formatBytes,
    formatDuration,
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

const DEFAULT_PATH = '/sites';
const MAX_DEPTH = 6;
const STATUS_POLL_MS = 2000;
const ELAPSED_TICK_MS = 1000;
const MAX_POLL_MS = 10 * 60 * 1000; // Stop watching a job after ~10 min
const BOTTOM_MARGIN = 24;
const MIN_HEIGHT = 320;
const VIEW_FLAMEGRAPH = 'flamegraph';
const VIEW_TABLE = 'table';
const VIEW_LARGEST = 'largest';
const VIEW_DIFF = 'diff';

// Status kinds for the alert / live region. Errors are distinct per failure path so the
// message is actionable; successes track which action completed for an accurate announcement.
const ERROR_COMPUTE = 'errorCompute';
const ERROR_LOAD = 'errorLoad';
const ERROR_BASELINE = 'errorBaseline';
const SUCCESS_COMPUTED = 'success';
const SUCCESS_LOADED = 'successLoaded';
const SUCCESS_BASELINE = 'successBaseline';
const INFO_CANCELLED = 'infoCancelled';
const INFO_TIMEOUT = 'infoTimeout';

const ERROR_STATUSES = [ERROR_COMPUTE, ERROR_LOAD, ERROR_BASELINE];
const SUCCESS_STATUSES = [SUCCESS_COMPUTED, SUCCESS_LOADED, SUCCESS_BASELINE];

const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Read the freshly-computed result and hand it to the supplied setters, guarded by isCancelled
// so an overlapping poll + result fetch can't apply a stale result. Extracted from the component
// to keep the component body's cyclomatic complexity in check.
const applyComputedResult = (fetchResult, statusPath, handlers) => {
    const {isCancelled, onResult, onError} = handlers;
    fetchResult({variables: {maxDepth: MAX_DEPTH}})
        .then(response => {
            if (isCancelled()) {
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
            if (isCancelled()) {
                return;
            }

            console.error('[jcr-stats] failed to fetch computation result', err);
            onError();
        });
};

// Drive one polled-status update. Returns true when the caller should register the result-fetch
// cancellation cleanup (i.e. a fetch was kicked off), false otherwise. All side effects go through
// the `ctx` setters so this stays a pure-ish controller, keeping the effect arrow's complexity low.
const handlePolledStatus = (current, ctx) => {
    const {pollStartMs, fetchResult, isCancelled, setters} = ctx;

    if (pollStartMs && (Date.now() - pollStartMs) > MAX_POLL_MS) {
        setters.stop(INFO_TIMEOUT);
        return false;
    }

    setters.setVisitedCount(Number(current.visitedCount) || 0);

    if (current.running) {
        setters.setRunning(Number(current.elapsedMs) || 0);
        return false;
    }

    if (current.error) {
        setters.stop(ERROR_COMPUTE);
        return false;
    }

    setters.setComputing(false);
    if (!current.hasResult) {
        return false;
    }

    applyComputedResult(fetchResult, current.path, {
        isCancelled,
        onResult: setters.onResult,
        onError: () => setters.setStatus(ERROR_COMPUTE)
    });
    return true;
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
                >
                    <div className={styles.js_progress_bar}/>
                </div>
            </div>
            {/* H-2 (ergonomy): client-side cancel — stops polling; server job may continue. */}
            <Button size="default" label={t('label.cancel')} onClick={onCancel}/>
        </div>
    );
};

// Visible alert banner for error (assertive red) and info (neutral) statuses. Returns null when
// the current status is neither, so the main render doesn't carry these branches.
const StatusBanner = ({t, status}) => {
    if (ERROR_STATUSES.includes(status)) {
        return (
            <div role="alert" className={`${styles.js_alert} ${styles['js_alert--error']}`}>
                {t(`label.${status}`)}
            </div>
        );
    }

    if (status === INFO_CANCELLED || status === INFO_TIMEOUT) {
        return (
            <div role="alert" className={`${styles.js_alert} ${styles['js_alert--info']}`}>
                {t(`label.${status}`)}
            </div>
        );
    }

    return null;
};

// Flamegraph view: caption (focused node or root summary + jContent link) and the mouse-only
// react-flame-graph. Extracted to a module-level component to keep the main render's complexity low.
const FlamegraphView = ({t, tree, focused, focusUrl, describeMetric, flameData, dimensions, containerRef, onFocusChange}) => {
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
            </div>
            {flameData && (
                /*
                  C-1: role="group" + aria-label wraps the mouse-only flamegraph so AT users
                  receive a meaningful description rather than an unlabelled SVG.
                */
                <div
                    ref={containerRef}
                    data-testid="jcrstats-flamegraph-react"
                    className={styles.js_flamegraph_react}
                    role="group"
                    aria-label={t('label.interactiveTitle')}
                >
                    <FlameGraph data={flameData} height={dimensions.height} width={dimensions.width} onChange={onFocusChange}/>
                </div>
            )}
        </>
    );
};

export const JcrStatsAdmin = () => {
    const {t} = useTranslation('jcr-stats');
    const [path, setPath] = useState(DEFAULT_PATH);
    const [pathError, setPathError] = useState(false);
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
    const containerRef = useRef(null);
    const fileInputRef = useRef(null);
    const baselineInputRef = useRef(null);
    // H-5: ref for the results region so focus can be moved to it on view change
    const resultsRegionRef = useRef(null);
    // Tracks real unmount so an in-flight result fetch is only discarded when the component is gone —
    // NOT when `computing` flips to false as part of completing the very computation we are reading.
    const isMountedRef = useRef(true);
    const [dimensions, setDimensions] = useState({width: 900, height: 600});

    useEffect(() => () => {
        isMountedRef.current = false;
    }, []);

    useEffect(() => {
        document.title = `${t('label.title')} — Jahia Administration`;
    }, [t]);

    const [startCompute] = useMutation(COMPUTE);
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

        // C-2 (code-quality): cancellation is gated on actual unmount (isMountedRef), not on this
        // effect's teardown — completing the computation flips `computing` to false, which would
        // otherwise tear this effect down and cancel the result fetch we just kicked off.
        handlePolledStatus(current, {
            pollStartMs: pollStartRef.current,
            fetchResult,
            isCancelled: () => !isMountedRef.current,
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

    // H-5: when view changes, move focus to the results region so keyboard/AT users land in the
    // new content. A useEffect keyed on `view` is more reliable than a setTimeout under React 18.
    useEffect(() => {
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
        setView(e.target.value);
    };

    const handlePathChange = e => {
        setPath(e.target.value);
        if (pathError) {
            setPathError(false);
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

    const openBaselineDialog = () => {
        if (baselineInputRef.current) {
            baselineInputRef.current.click();
        }
    };

    const handleCompute = async () => {
        // H-3 (ergonomy): block a blank path instead of silently traversing the whole repo from '/'.
        const targetPath = (path || '').trim();
        if (!targetPath) {
            setPathError(true);
            return;
        }

        setPathError(false);
        setStatus(null);
        setFocused(null);
        setVisitedCount(0);
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

    // Client-side cancel: there is no server cancel, so we just stop watching and tell the user the
    // job may still be running on the server.
    const handleCancel = () => {
        setComputing(false);
        setStatus(INFO_CANCELLED);
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
            setFocused(null);
            setTreePath(loadedPath);
            setTree(loaded);
            setView(VIEW_FLAMEGRAPH);
            setStatus(SUCCESS_LOADED);
        }, ERROR_LOAD);
    };

    const handleBaselineSelected = event => {
        const file = event.target.files && event.target.files[0];
        event.target.value = '';
        if (!file) {
            return;
        }

        readFile(file, ({tree: loaded}) => {
            setBaseline(loaded);
            setView(VIEW_DIFF);
            setStatus(SUCCESS_BASELINE);
        }, ERROR_BASELINE);
    };

    const focusUrl = focused ? buildJContentUrl(focused.path) : null;
    const isError = ERROR_STATUSES.includes(status);
    const isSuccess = SUCCESS_STATUSES.includes(status);
    const isInfo = status === INFO_CANCELLED || status === INFO_TIMEOUT;

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
                            {t('label.pathRequired')}
                        </span>
                    )}
                    <label className={styles.js_label} htmlFor="jcrstats-metric">{t('label.metric')}</label>
                    <select id="jcrstats-metric" className={styles.js_select} value={metric} onChange={handleMetricChange}>
                        <option value={METRIC_SIZE}>{t('label.metricSize')}</option>
                        <option value={METRIC_NODES}>{t('label.metricNodes')}</option>
                    </select>
                    <Button size="big" color="accent" icon={<Bar/>} label={t('label.compute')} isDisabled={computing} onClick={handleCompute}/>
                    <Button size="big" icon={<Upload/>} label={t('label.load')} isDisabled={computing} onClick={openLoadDialog}/>
                    <Button size="big" icon={<Compare/>} label={t('label.compareWith')} isDisabled={computing} onClick={openBaselineDialog}/>
                    {/*
                      H-3: Hidden file inputs are now clipped (sr-only) rather than display:none
                      so AT can discover them, and each has an associated <label> for a proper
                      accessible name. The buttons above still trigger them programmatically.
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
                    <label htmlFor="jcrstats-baseline-input" className={styles.js_sr_only}>
                        {t('label.baselineFileLabel')}
                    </label>
                    <input
                        ref={baselineInputRef}
                        id="jcrstats-baseline-input"
                        data-testid="jcrstats-baseline-input"
                        type="file"
                        accept="application/json,.json"
                        className={styles.js_sr_only}
                        tabIndex={-1}
                        onChange={handleBaselineSelected}
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
                        />
                    )}

                    {view === VIEW_TABLE && <TreeTable key={treePath} tree={tree} metric={metric}/>}
                    {view === VIEW_LARGEST && <TopList key={treePath} tree={tree} metric={metric}/>}
                    {view === VIEW_DIFF && baseline && <DiffTable baseline={baseline} current={tree}/>}
                </section>
            )}
        </div>
    );
};
