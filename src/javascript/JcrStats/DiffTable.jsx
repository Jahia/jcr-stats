import React from 'react';
import {useTranslation} from 'react-i18next';
import styles from './JcrStats.scss';
import {formatBytes, signedBytes, diffTrees, buildJContentUrl} from './jcrStatsUtils';

const TOP_N = 30;

export const DiffTable = ({baseline, current}) => {
    const {t} = useTranslation('jcr-stats');
    const rows = diffTrees(baseline, current).filter(r => r.delta !== 0).slice(0, TOP_N);

    return (
        <div className={styles.js_tableWrap} data-testid="jcrstats-diff">
            <table className={styles.js_table}>
                <thead>
                    <tr>
                        <th>{t('label.tableName')}</th>
                        <th>{t('label.tablePath')}</th>
                        <th className={styles.js_num}>{t('label.diffBaseline')}</th>
                        <th className={styles.js_num}>{t('label.diffCurrent')}</th>
                        <th className={styles.js_num}>{t('label.diffDelta')}</th>
                        <th/>
                    </tr>
                </thead>
                <tbody>
                    {rows.length === 0 && (
                        <tr><td colSpan={6}>{t('label.diffNone')}</td></tr>
                    )}
                    {rows.map((row, index) => {
                        const url = buildJContentUrl(row.path);
                        return (
                            <tr key={row.path || index} className={row.delta > 0 ? styles.js_grew : styles.js_shrank}>
                                <td>{row.name}</td>
                                <td className={styles.js_path}>{row.path}</td>
                                <td className={styles.js_num}>{formatBytes(row.baseSize)}</td>
                                <td className={styles.js_num}>{formatBytes(row.curSize)}</td>
                                <td className={styles.js_num}>{signedBytes(row.delta)}</td>
                                <td>{url && <a href={url} target="_blank" rel="noopener noreferrer">{t('label.openJContent')}</a>}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};
