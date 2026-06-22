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
                        {/* H-4: scope="col" on every th */}
                        <th scope="col">{t('label.tableName')}</th>
                        <th scope="col">{t('label.tablePath')}</th>
                        <th scope="col" className={styles.js_num}>{t('label.diffBaseline')}</th>
                        <th scope="col" className={styles.js_num}>{t('label.diffCurrent')}</th>
                        <th scope="col" className={styles.js_num}>{t('label.diffDelta')}</th>
                        {/* H-4: empty action column gets sr-only label */}
                        <th scope="col"><span className={styles.js_sr_only}>{t('label.actions')}</span></th>
                    </tr>
                </thead>
                <tbody>
                    {rows.length === 0 && (
                        <tr><td colSpan={6}>{t('label.diffNone')}</td></tr>
                    )}
                    {rows.map((row, index) => {
                        const url = buildJContentUrl(row.path);
                        const grew = row.delta > 0;
                        return (
                            <tr key={row.path || index} className={grew ? styles.js_grew : styles.js_shrank}>
                                <td>{row.name}</td>
                                <td className={styles.js_path}>{row.path}</td>
                                <td className={styles.js_num}>{formatBytes(row.baseSize)}</td>
                                <td className={styles.js_num}>{formatBytes(row.curSize)}</td>
                                <td className={styles.js_num}>
                                    {/*
                                      C-2: direction indicator so the change is not colour-only.
                                      The visible glyph (▲/▼) gives a non-colour cue.
                                      The sr-only span adds a plain-text word ("increased"/"decreased")
                                      so screen readers get the full meaning without reading the glyph name.
                                    */}
                                    <span aria-hidden="true">{grew ? '▲' : '▼'}</span>
                                    <span className={styles.js_sr_only}>{grew ? t('label.increased') : t('label.decreased')}</span>
                                    {' '}{signedBytes(row.delta)}
                                </td>
                                <td>
                                    {url && (
                                        /* L-2: opensNewTab appended to aria-label */
                                        <a
                                            href={url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            aria-label={`${t('label.openJContent')} ${t('label.opensNewTab')}`}
                                        >
                                            {t('label.openJContent')}
                                        </a>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};
