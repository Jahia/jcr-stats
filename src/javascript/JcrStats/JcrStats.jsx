import React, {useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo} from 'react';
import {useLazyQuery} from '@apollo/client';
import {useTranslation} from 'react-i18next';
import {Button, Loader, Typography} from '@jahia/moonstone';
import {FlameGraph} from 'react-flame-graph';
import styles from './JcrStats.scss';
import {GET_TREE} from './JcrStats.gql';

const DEFAULT_PATH = '/sites/systemsite';
const MAX_DEPTH = 6;
const KIB = 1024;
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
// Vertical space taken by the header + description + form above the flamegraph.
const HEIGHT_OFFSET = 260;
const MIN_HEIGHT = 320;

const formatBytes = bytes => {
    if (bytes === null || bytes === undefined || bytes < 0) {
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

// Map the jcrStats.tree GraphQL shape onto react-flame-graph's {name, value, children}.
// value is floored at 1 so zero-byte subtrees still render a frame instead of NaN widths.
const toFlameNode = node => ({
    name: node.name,
    value: Math.max(Number(node.size), 1),
    tooltip: `${node.name}: ${formatBytes(node.size)}`,
    children: (node.children || []).map(toFlameNode)
});

export const JcrStatsAdmin = () => {
    const {t} = useTranslation('jcr-stats');
    const [path, setPath] = useState(DEFAULT_PATH);
    const [status, setStatus] = useState(null);
    const containerRef = useRef(null);
    const [dimensions, setDimensions] = useState({width: 900, height: 600});

    useEffect(() => {
        document.title = `${t('label.title')} — Jahia Administration`;
    }, [t]);

    const [loadTree, {data: treeData, loading}] = useLazyQuery(GET_TREE, {fetchPolicy: 'network-only'});
    const tree = treeData?.jcrStats?.tree || null;

    // Stable identity: react-flame-graph reacts to `data` changes, so a fresh object every
    // render (combined with the resize effect) would loop forever (React error #185).
    const flameData = useMemo(() => (tree ? toFlameNode(tree) : null), [tree]);

    // Fit the flamegraph to the available width (its container) and the window height.
    const measure = useCallback(() => {
        const width = containerRef.current ? containerRef.current.clientWidth : 0;
        const height = Math.max(MIN_HEIGHT, window.innerHeight - HEIGHT_OFFSET);
        const nextWidth = width > 0 ? width : window.innerWidth;
        setDimensions(prev => (prev.width === nextWidth && prev.height === height ? prev : {width: nextWidth, height}));
    }, []);

    useLayoutEffect(() => {
        if (!flameData) {
            return undefined;
        }
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, [flameData, measure]);

    const handleCompute = async () => {
        setStatus(null);
        try {
            await loadTree({variables: {path: path || '/', maxDepth: MAX_DEPTH}});
            setStatus('success');
        } catch (_err) {
            setStatus('error');
        }
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
                />
                <Button
                    size="big"
                    color="accent"
                    label={t('label.compute')}
                    isDisabled={loading}
                    onClick={handleCompute}
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

            {/* Interactive, in-app flamegraph rendered directly in React from jcrStats.tree */}
            {flameData && (
                <div className={styles.js_interactive}>
                    <Typography weight="bold" className={styles.js_interactive_title}>
                        {t('label.interactiveTitle')}
                    </Typography>
                    <div data-testid="jcrstats-flamegraph-caption" className={styles.js_caption}>
                        {tree.name} — {formatBytes(tree.size)}
                    </div>
                    <div ref={containerRef} data-testid="jcrstats-flamegraph-react" className={styles.js_flamegraph_react}>
                        <FlameGraph data={flameData} height={dimensions.height} width={dimensions.width}/>
                    </div>
                </div>
            )}
        </div>
    );
};
