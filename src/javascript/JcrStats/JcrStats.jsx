import React, {useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo} from 'react';
import {useLazyQuery, useMutation, useQuery} from '@apollo/client';
import {useTranslation} from 'react-i18next';
import {Button, Loader, Typography, Bar, Download, Upload, Compare} from '@jahia/moonstone';
import {FlameGraph} from 'react-flame-graph';
import styles from './JcrStats.scss';
import {COMPUTE, GET_STATUS, GET_RESULT} from './JcrStats.gql';
import {formatBytes, METRIC_SIZE, METRIC_NODES, buildJContentUrl} from './jcrStatsUtils';
import {TreeTable} from './TreeTable';
import {TopList} from './TopList';
import {DiffTable} from './DiffTable';

const DEFAULT_PATH = '/sites';
const MAX_DEPTH = 6;
const STATUS_POLL_MS = 2000;
const BOTTOM_MARGIN = 24;
const MIN_HEIGHT = 320;
const SAVE_FORMAT = 'jcr-stats-flamegraph';
const VIEW_FLAMEGRAPH = 'flamegraph';
const VIEW_TABLE = 'table';
const VIEW_LARGEST = 'largest';
const VIEW_DIFF = 'diff';

// Map the jcrStats.tree shape onto react-flame-graph's {name, value, children}. The `value`
// (frame width) follows the chosen metric, floored at 1 so zero-weight subtrees still render.
// Raw measures + path are kept on the node (carried on react-flame-graph's `.source`).
const toFlameNode = (node, metric) => {
    const bytes = Number.isFinite(Number(node.size)) ? Number(node.size) : 0;
    const nodeCount = Number.isFinite(Number(node.nodeCount)) ? Number(node.nodeCount) : 0;
    const weight = metric === METRIC_NODES ? nodeCount : bytes;
    return {
        name: typeof node.name === 'string' ? node.name : '(unknown)',
        value: Math.max(weight, 1),
        bytes,
        nodeCount,
        nodePath: node.path,
        tooltip: `${node.name}: ${formatBytes(bytes)} · ${nodeCount} nodes`,
        children: Array.isArray(node.children) ? node.children.map(child => toFlameNode(child, metric)) : []
    };
};

// Validate + extract a tree from an imported file (export envelope or a raw tree node).
const extractTree = parsed => {
    const loaded = parsed && parsed.tree ? parsed.tree : parsed;
    if (!loaded || typeof loaded.name !== 'string' || loaded.size === undefined) {
        return null;
    }

    return {tree: loaded, path: (parsed && parsed.path) || loaded.name};
};

export const JcrStatsAdmin = () => {
    const {t} = useTranslation('jcr-stats');
    const [path, setPath] = useState(DEFAULT_PATH);
    const [metric, setMetric] = useState(METRIC_SIZE);
    const [view, setView] = useState(VIEW_FLAMEGRAPH);
    const [status, setStatus] = useState(null);
    const [focused, setFocused] = useState(null);
    const [tree, setTree] = useState(null);
    const [treePath, setTreePath] = useState(DEFAULT_PATH);
    const [baseline, setBaseline] = useState(null);
    const [computing, setComputing] = useState(false);
    const containerRef = useRef(null);
    const fileInputRef = useRef(null);
    const baselineInputRef = useRef(null);
    // H-5: ref for the results region so focus can be moved to it on view change
    const resultsRegionRef = useRef(null);
    const [dimensions, setDimensions] = useState({width: 900, height: 600});

    useEffect(() => {
        document.title = `${t('label.title')} — Jahia Administration`;
    }, [t]);

    const [startCompute] = useMutation(COMPUTE);
    const [fetchResult] = useLazyQuery(GET_RESULT, {fetchPolicy: 'network-only'});
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
        if (!computing) {
            return;
        }

        const current = statusData && statusData.jcrStats && statusData.jcrStats.status;
        if (!current || current.running) {
            return;
        }

        setComputing(false);
        if (current.error) {
            setStatus('error');
            return;
        }

        if (current.hasResult) {
            fetchResult({variables: {maxDepth: MAX_DEPTH}})
                .then(response => {
                    const computed = response && response.data && response.data.jcrStats && response.data.jcrStats.result;
                    if (computed) {
                        setFocused(null);
                        setTree(computed);
                        setTreePath(current.path);
                        setView(VIEW_FLAMEGRAPH);
                        setStatus('success');
                    } else {
                        setStatus('error');
                    }
                })
                .catch(() => setStatus('error'));
        }
    }, [statusData, computing, fetchResult]);

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

    // H-5: when view changes, shift focus to the results region so keyboard/AT users
    // land in the new content without having to navigate past the controls again.
    const handleViewChange = e => {
        setView(e.target.value);
        // Focus the results region on the next render tick after state settles
        setTimeout(() => {
            if (resultsRegionRef.current) {
                resultsRegionRef.current.focus();
            }
        }, 0);
    };

    const handleCompute = async () => {
        setStatus(null);
        setFocused(null);
        const targetPath = path || '/';
        try {
            // Fire-and-forget: starts the server-side job (no-op if one is already running),
            // then we poll jcrStats.status and fetch the result when it completes.
            await startCompute({variables: {path: targetPath}});
            setComputing(true);
        } catch (_) {
            setStatus('error');
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

    const readFile = (file, onTree) => {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const extracted = extractTree(JSON.parse(reader.result));
                if (extracted) {
                    onTree(extracted);
                } else {
                    setStatus('error');
                }
            } catch (_) {
                setStatus('error');
            }
        };

        reader.onerror = () => setStatus('error');
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
            setStatus('success');
        });
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
            setStatus('success');
        });
    };

    const focusUrl = focused ? buildJContentUrl(focused.path) : null;

    return (
        <div className={styles.js_container}>
            {/*
              M-3/M-4: Single polite status region for success announcements.
              The visible error banner below carries role="alert" so it serves as the
              assertive live region — no duplicate sr-only alert div needed.
            */}
            <div role="status" aria-live="polite" aria-atomic="true" className={styles.js_sr_only}>
                {status === 'success' ? t('label.success') : ''}
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
                        onChange={e => setPath(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                e.preventDefault();
                                handleCompute();
                            }
                        }}
                    />
                    <label className={styles.js_label} htmlFor="jcrstats-metric">{t('label.metric')}</label>
                    <select id="jcrstats-metric" className={styles.js_select} value={metric} onChange={handleMetricChange}>
                        <option value={METRIC_SIZE}>{t('label.metricSize')}</option>
                        <option value={METRIC_NODES}>{t('label.metricNodes')}</option>
                    </select>
                    <Button size="big" color="accent" icon={<Bar/>} label={t('label.compute')} isDisabled={computing} onClick={handleCompute}/>
                    <Button size="big" icon={<Upload/>} label={t('label.load')} isDisabled={computing} onClick={() => fileInputRef.current && fileInputRef.current.click()}/>
                    <Button size="big" icon={<Compare/>} label={t('label.compareWith')} isDisabled={computing} onClick={() => baselineInputRef.current && baselineInputRef.current.click()}/>
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
                <div className={styles.js_running}>
                    <Loader size="big"/>
                    <Typography className={styles.js_running_text}>{t('label.computing')}</Typography>
                </div>
            )}

            {/*
              M-3/M-4: Visible error banner carries role="alert" (assertive by default).
              The duplicate sr-only assertive div has been removed — this banner IS the
              live region, so AT announces the error exactly once.
            */}
            {status === 'error' && (
                <div role="alert" className={`${styles.js_alert} ${styles['js_alert--error']}`}>
                    {t('label.error')}
                </div>
            )}

            {!tree && !computing && status !== 'error' && (
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
                        {/* H-5: handleViewChange moves focus to results region after state update */}
                        <select id="jcrstats-view" className={styles.js_select} value={view} onChange={handleViewChange}>
                            <option value={VIEW_FLAMEGRAPH}>{t('label.viewFlamegraph')}</option>
                            <option value={VIEW_TABLE}>{t('label.viewTable')}</option>
                            <option value={VIEW_LARGEST}>{t('label.viewLargest')}</option>
                            {baseline && <option value={VIEW_DIFF}>{t('label.viewDiff')}</option>}
                        </select>
                        <Button size="default" icon={<Download/>} label={t('label.save')} onClick={handleSave}/>
                    </div>

                    {view === VIEW_FLAMEGRAPH && (
                        <>
                            {/*
                              C-1: Keyboard hint visible to all users informing them that
                              the flamegraph is mouse-operated and the Tree table is the
                              keyboard-accessible equivalent.
                            */}
                            <Typography className={styles.js_hint}>{t('label.keyboardHint')}</Typography>
                            <Typography className={styles.js_hint}>{t('label.clickHint')}</Typography>
                            <div data-testid="jcrstats-flamegraph-caption" className={styles.js_caption}>
                                {focused ?
                                    `${t('label.focused')}: ${focused.name} — ${describeMetric(focused.bytes, focused.nodeCount)}` :
                                    `${tree.name} — ${describeMetric(tree.size, tree.nodeCount)}`}
                                {focusUrl && (
                                    /*
                                      L-2: opensNewTab appended to aria-label for the jContent link.
                                      The visible label text is preserved for Cypress selectors.
                                    */
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
                                  C-1: role="group" + aria-label wraps the mouse-only flamegraph
                                  so AT users receive a meaningful description of the region
                                  rather than encountering an unlabelled SVG.
                                */
                                <div
                                    ref={containerRef}
                                    data-testid="jcrstats-flamegraph-react"
                                    className={styles.js_flamegraph_react}
                                    role="group"
                                    aria-label={t('label.interactiveTitle')}
                                >
                                    <FlameGraph data={flameData} height={dimensions.height} width={dimensions.width} onChange={handleFocusChange}/>
                                </div>
                            )}
                        </>
                    )}

                    {view === VIEW_TABLE && <TreeTable key={treePath} tree={tree} metric={metric}/>}
                    {view === VIEW_LARGEST && <TopList key={treePath} tree={tree} metric={metric}/>}
                    {view === VIEW_DIFF && baseline && <DiffTable baseline={baseline} current={tree}/>}
                </section>
            )}
        </div>
    );
};
