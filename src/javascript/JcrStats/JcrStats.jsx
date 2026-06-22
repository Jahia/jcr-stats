import React, {useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo} from 'react';
import {useLazyQuery} from '@apollo/client';
import {useTranslation} from 'react-i18next';
import {Button, Loader, Typography, Bar, Download, Upload, Compare} from '@jahia/moonstone';
import {FlameGraph} from 'react-flame-graph';
import styles from './JcrStats.scss';
import {GET_TREE} from './JcrStats.gql';
import {formatBytes, METRIC_SIZE, METRIC_NODES, buildJContentUrl} from './jcrStatsUtils';
import {TreeTable} from './TreeTable';
import {TopList} from './TopList';
import {DiffTable} from './DiffTable';

const DEFAULT_PATH = '/sites';
const MAX_DEPTH = 6;
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
    const containerRef = useRef(null);
    const fileInputRef = useRef(null);
    const baselineInputRef = useRef(null);
    const [dimensions, setDimensions] = useState({width: 900, height: 600});

    useEffect(() => {
        document.title = `${t('label.title')} — Jahia Administration`;
    }, [t]);

    const [loadTree, {loading}] = useLazyQuery(GET_TREE, {fetchPolicy: 'network-only'});

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
                setView(VIEW_FLAMEGRAPH);
                setStatus('success');
            } else {
                setStatus('error');
            }
        } catch (_err) {
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
            } catch (_err) {
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
                <Button size="big" color="accent" icon={<Bar/>} label={t('label.compute')} isDisabled={loading} onClick={handleCompute}/>
                <Button size="big" icon={<Upload/>} label={t('label.load')} onClick={() => fileInputRef.current && fileInputRef.current.click()}/>
                <Button size="big" icon={<Compare/>} label={t('label.compareWith')} onClick={() => baselineInputRef.current && baselineInputRef.current.click()}/>
                <input ref={fileInputRef} id="jcrstats-load-input" data-testid="jcrstats-load-input" type="file" accept="application/json,.json" className={styles.js_hiddenInput} onChange={handleFileSelected}/>
                <input ref={baselineInputRef} id="jcrstats-baseline-input" data-testid="jcrstats-baseline-input" type="file" accept="application/json,.json" className={styles.js_hiddenInput} onChange={handleBaselineSelected}/>
            </div>

            {loading && (
                <div className={styles.js_running}>
                    <Loader size="big"/>
                    <Typography className={styles.js_running_text}>{t('label.computing')}</Typography>
                </div>
            )}

            {status === 'error' && (
                <div className={`${styles.js_alert} ${styles['js_alert--error']}`}>{t('label.error')}</div>
            )}

            {tree && (
                <div className={styles.js_interactive}>
                    <div className={styles.js_interactive_head}>
                        <label className={styles.js_label} htmlFor="jcrstats-view">{t('label.view')}</label>
                        <select id="jcrstats-view" className={styles.js_select} value={view} onChange={e => setView(e.target.value)}>
                            <option value={VIEW_FLAMEGRAPH}>{t('label.viewFlamegraph')}</option>
                            <option value={VIEW_TABLE}>{t('label.viewTable')}</option>
                            <option value={VIEW_LARGEST}>{t('label.viewLargest')}</option>
                            {baseline && <option value={VIEW_DIFF}>{t('label.viewDiff')}</option>}
                        </select>
                        <Button size="default" icon={<Download/>} label={t('label.save')} onClick={handleSave}/>
                    </div>

                    {view === VIEW_FLAMEGRAPH && (
                        <>
                            <Typography className={styles.js_hint}>{t('label.clickHint')}</Typography>
                            <div data-testid="jcrstats-flamegraph-caption" className={styles.js_caption}>
                                {focused
                                    ? `${t('label.focused')}: ${focused.name} — ${describeMetric(focused.bytes, focused.nodeCount)}`
                                    : `${tree.name} — ${describeMetric(tree.size, tree.nodeCount)}`}
                                {focusUrl && (
                                    <a className={styles.js_focusLink} href={focusUrl} target="_blank" rel="noopener noreferrer">
                                        {t('label.openJContent')}
                                    </a>
                                )}
                            </div>
                            {flameData && (
                                <div ref={containerRef} data-testid="jcrstats-flamegraph-react" className={styles.js_flamegraph_react}>
                                    <FlameGraph data={flameData} height={dimensions.height} width={dimensions.width} onChange={handleFocusChange}/>
                                </div>
                            )}
                        </>
                    )}

                    {view === VIEW_TABLE && <TreeTable tree={tree} metric={metric}/>}
                    {view === VIEW_LARGEST && <TopList tree={tree} metric={metric}/>}
                    {view === VIEW_DIFF && baseline && <DiffTable baseline={baseline} current={tree}/>}
                </div>
            )}
        </div>
    );
};
