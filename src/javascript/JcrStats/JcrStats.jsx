import React, {useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo} from 'react';
import {useLazyQuery} from '@apollo/client';
import {useTranslation} from 'react-i18next';
import {Button, Loader, Typography, Bar, Download, Upload} from '@jahia/moonstone';
import {FlameGraph} from 'react-flame-graph';
import styles from './JcrStats.scss';
import {GET_TREE} from './JcrStats.gql';

const DEFAULT_PATH = '/sites/systemsite';
const MAX_DEPTH = 6;
const METRIC_SIZE = 'size';
const METRIC_NODES = 'nodes';
const KIB = 1024;
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
// Gap left between the flamegraph and the bottom of the window.
const BOTTOM_MARGIN = 24;
const MIN_HEIGHT = 320;
const SAVE_FORMAT = 'jcr-stats-flamegraph';

const formatBytes = bytes => {
    if (bytes === null || bytes === undefined || !Number.isFinite(Number(bytes)) || bytes < 0) {
        return '—';
    }
    let value = Number(bytes);
    let unitIndex = 0;
    while (value >= KIB && unitIndex < UNITS.length - 1) {
        value /= KIB;
        unitIndex += 1;
    }
    return `${unitIndex === 0 ? value : value.toFixed(1)} ${UNITS[unitIndex]}`;
};

// Map the jcrStats.tree shape onto react-flame-graph's {name, value, children}. The `value`
// (frame width) is driven by the chosen metric — aggregated bytes or aggregated node count —
// floored at 1 so zero-weight subtrees still render a frame. Both raw measures are kept on the
// node (carried through on react-flame-graph's `.source`) for the caption/tooltip. Values are
// coerced defensively because the tree may come from an imported (untrusted) file.
const toFlameNode = (node, metric) => {
    const bytes = Number.isFinite(Number(node.size)) ? Number(node.size) : 0;
    const nodeCount = Number.isFinite(Number(node.nodeCount)) ? Number(node.nodeCount) : 0;
    const weight = metric === METRIC_NODES ? nodeCount : bytes;
    return {
        name: typeof node.name === 'string' ? node.name : '(unknown)',
        value: Math.max(weight, 1),
        bytes,
        nodeCount,
        tooltip: `${node.name}: ${formatBytes(bytes)} · ${nodeCount} nodes`,
        children: Array.isArray(node.children) ? node.children.map(child => toFlameNode(child, metric)) : []
    };
};

export const JcrStatsAdmin = () => {
    const {t} = useTranslation('jcr-stats');
    const [path, setPath] = useState(DEFAULT_PATH);
    const [metric, setMetric] = useState(METRIC_SIZE);
    const [status, setStatus] = useState(null);
    const [focused, setFocused] = useState(null);
    const [tree, setTree] = useState(null);
    const [treePath, setTreePath] = useState(DEFAULT_PATH);
    const containerRef = useRef(null);
    const fileInputRef = useRef(null);
    const [dimensions, setDimensions] = useState({width: 900, height: 600});

    useEffect(() => {
        document.title = `${t('label.title')} — Jahia Administration`;
    }, [t]);

    const [loadTree, {loading}] = useLazyQuery(GET_TREE, {fetchPolicy: 'network-only'});

    // Stable identity: react-flame-graph reacts to `data` changes, so a fresh object every
    // render (combined with the resize effect) would loop forever (React error #185).
    const flameData = useMemo(() => (tree ? toFlameNode(tree, metric) : null), [tree, metric]);

    // Format a measure according to the selected metric.
    const describeMetric = useCallback((bytes, nodeCount) => (
        metric === METRIC_NODES ? `${nodeCount} ${t('label.nodesUnit')}` : formatBytes(bytes)
    ), [metric, t]);

    // Fit the flamegraph to the available width, and to the height between its own top edge
    // and the bottom of the window (so it never extends past the viewport bottom).
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
        if (!flameData) {
            return undefined;
        }
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, [flameData, measure]);

    // Clicking a frame zooms react-flame-graph and reports the focused node here.
    // onChange receives the internal chart node; the original measures are on `.source`.
    const handleFocusChange = useCallback(node => {
        if (node) {
            const source = node.source || node;
            setFocused({name: source.name, bytes: source.bytes, nodeCount: source.nodeCount});
        }
    }, []);

    const handleMetricChange = e => {
        setMetric(e.target.value);
        setFocused(null);
    };

    const handleCompute = async () => {
        setStatus(null);
        setFocused(null);
        const targetPath = path || '/';
        try {
            const result = await loadTree({variables: {path: targetPath, maxDepth: MAX_DEPTH}});
            const computed = result?.data?.jcrStats?.tree;
            if (computed) {
                setTree(computed);
                setTreePath(targetPath);
                setStatus('success');
            } else {
                setStatus('error');
            }
        } catch (_err) {
            setStatus('error');
        }
    };

    // Save the current tree to a JSON file for offline analysis / sharing.
    const handleSave = () => {
        if (!tree) {
            return;
        }
        const payload = {
            format: SAVE_FORMAT,
            version: 1,
            path: treePath,
            maxDepth: MAX_DEPTH,
            exportedAt: new Date().toISOString(),
            tree
        };
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

    const handleLoadClick = () => {
        if (fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    // Load a previously saved tree (accepts the {format, path, tree} envelope or a raw tree node).
    const handleFileSelected = event => {
        const file = event.target.files && event.target.files[0];
        event.target.value = ''; // allow re-selecting the same file
        if (!file) {
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(reader.result);
                const loaded = parsed && parsed.tree ? parsed.tree : parsed;
                if (!loaded || typeof loaded.name !== 'string' || loaded.size === undefined) {
                    setStatus('error');
                    return;
                }
                setFocused(null);
                setTreePath((parsed && parsed.path) || loaded.name);
                setTree(loaded);
                setStatus('success');
            } catch (_err) {
                setStatus('error');
            }
        };
        reader.onerror = () => setStatus('error');
        reader.readAsText(file);
    };

    return (
        <div className={styles.js_container}>
            {/* Fixed-role live regions for screen readers */}
            <div role="status" aria-live="polite" aria-atomic="true" className={styles.js_sr_only}>
                {status === 'success' ? t('label.success') : ''}
            </div>
            <div role="alert" aria-live="assertive" aria-atomic="true" className={styles.js_sr_only}>
                {status === 'error' ? t('label.error') : ''}
            </div>

            <div className={styles.js_header}>
                <h2>{t('label.title')}</h2>
            </div>

            <div className={styles.js_description}>
                <Typography>{t('label.description')}</Typography>
            </div>

            <div className={styles.js_form}>
                <label className={styles.js_label} htmlFor="jcrstats-path">{t('label.path')}</label>
                <input
                    id="jcrstats-path"
                    type="text"
                    className={styles.js_input}
                    value={path}
                    onChange={e => setPath(e.target.value)}
                    onKeyDown={e => {
                        // Ctrl+Enter (or Cmd+Enter) submits the form.
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                            e.preventDefault();
                            handleCompute();
                        }
                    }}
                />
                <label className={styles.js_label} htmlFor="jcrstats-metric">{t('label.metric')}</label>
                <select
                    id="jcrstats-metric"
                    className={styles.js_select}
                    value={metric}
                    onChange={handleMetricChange}
                >
                    <option value={METRIC_SIZE}>{t('label.metricSize')}</option>
                    <option value={METRIC_NODES}>{t('label.metricNodes')}</option>
                </select>
                <Button
                    size="big"
                    color="accent"
                    icon={<Bar/>}
                    label={t('label.compute')}
                    isDisabled={loading}
                    onClick={handleCompute}
                />
                <Button
                    size="big"
                    icon={<Upload/>}
                    label={t('label.load')}
                    onClick={handleLoadClick}
                />
                <input
                    ref={fileInputRef}
                    id="jcrstats-load-input"
                    data-testid="jcrstats-load-input"
                    type="file"
                    accept="application/json,.json"
                    className={styles.js_hiddenInput}
                    onChange={handleFileSelected}
                />
            </div>

            {loading && (
                <div className={styles.js_running}>
                    <Loader size="big"/>
                    <Typography className={styles.js_running_text}>{t('label.computing')}</Typography>
                </div>
            )}

            {status === 'error' && (
                <div className={`${styles.js_alert} ${styles['js_alert--error']}`}>
                    {t('label.error')}
                </div>
            )}

            {/* Interactive, in-app flamegraph rendered directly in React from the tree data */}
            {flameData && (
                <div className={styles.js_interactive}>
                    <div className={styles.js_interactive_head}>
                        <Typography weight="bold" className={styles.js_interactive_title}>
                            {t('label.interactiveTitle')}
                        </Typography>
                        <Typography className={styles.js_hint}>{t('label.clickHint')}</Typography>
                        <Button
                            size="default"
                            icon={<Download/>}
                            label={t('label.save')}
                            onClick={handleSave}
                        />
                    </div>
                    <div data-testid="jcrstats-flamegraph-caption" className={styles.js_caption}>
                        {focused
                            ? `${t('label.focused')}: ${focused.name} — ${describeMetric(focused.bytes, focused.nodeCount)}`
                            : `${tree.name} — ${describeMetric(tree.size, tree.nodeCount)}`}
                    </div>
                    <div ref={containerRef} data-testid="jcrstats-flamegraph-react" className={styles.js_flamegraph_react}>
                        <FlameGraph
                            data={flameData}
                            height={dimensions.height}
                            width={dimensions.width}
                            onChange={handleFocusChange}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};
