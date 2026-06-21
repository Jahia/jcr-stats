import React, {useState} from 'react';
import {useMutation, useQuery} from '@apollo/client';
import {useTranslation} from 'react-i18next';
import {Button, Loader, Typography} from '@jahia/moonstone';
import styles from './JcrStats.scss';
import {COMPUTE_SIZE, GET_REPORTS} from './JcrStats.gql';

const DEFAULT_PATH = '/sites/systemsite';
const KIB = 1024;
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

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

export const JcrStatsAdmin = () => {
    const {t} = useTranslation('jcr-stats');
    const [path, setPath] = useState(DEFAULT_PATH);
    const [result, setResult] = useState(null);
    const [status, setStatus] = useState(null);

    React.useEffect(() => {
        document.title = `${t('label.title')} — Jahia Administration`;
    }, [t]);

    const {data: reportsData, refetch: refetchReports} = useQuery(GET_REPORTS, {fetchPolicy: 'network-only'});
    const [computeSize, {loading}] = useMutation(COMPUTE_SIZE);

    const handleCompute = async () => {
        setStatus(null);
        try {
            const response = await computeSize({variables: {path: path || '/', deleteTemporaryFile: false}});
            const data = response.data?.jcrStats?.computeSize;
            if (data) {
                setResult(data);
                setStatus('success');
                refetchReports();
            } else {
                setStatus('error');
            }
        } catch (_err) {
            setStatus('error');
        }
    };

    const reports = reportsData?.jcrStats?.reports || [];

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

            {status === 'success' && result && (
                <div data-testid="jcrstats-result" className={styles.js_result}>
                    <Typography weight="bold">{t('label.resultTitle')}</Typography>
                    <ul>
                        <li>{t('label.path')}: <span data-testid="jcrstats-result-path">{result.path}</span></li>
                        <li>
                            {t('label.totalSize')}: <span data-testid="jcrstats-result-size">{formatBytes(result.totalSize)}</span>
                            {' '}(<span data-testid="jcrstats-result-bytes">{result.totalSize}</span> B)
                        </li>
                        <li>{t('label.nodeCount')}: <span data-testid="jcrstats-result-count">{result.nodeCount}</span></li>
                        <li>{t('label.flamegraph')}: <span data-testid="jcrstats-result-flamegraph">{result.flamegraphPath}</span></li>
                    </ul>

                    {result.flamegraphUrl && (
                        <div className={styles.js_flamegraph}>
                            <a
                                data-testid="jcrstats-flamegraph-link"
                                className={styles.js_flamegraph_link}
                                href={result.flamegraphUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                {t('label.openNewTab')}
                            </a>
                            <iframe
                                data-testid="jcrstats-flamegraph-frame"
                                className={styles.js_flamegraph_frame}
                                title={t('label.flamegraph')}
                                src={result.flamegraphUrl}
                            />
                        </div>
                    )}
                </div>
            )}

            <div className={styles.js_reports}>
                <Typography weight="bold">{t('label.reportsTitle')}</Typography>
                <ul data-testid="jcrstats-reports">
                    {reports.map(report => (
                        <li key={report.path}>
                            <a href={report.url} target="_blank" rel="noopener noreferrer">{report.path}</a>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};
