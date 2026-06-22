import React from 'react';
import {useTranslation} from 'react-i18next';
import styles from './JcrStats.scss';
import {formatBytes, measureOf, percent, flatten} from './jcrStatsUtils';
import {JContentLink} from './JContentLink';

const TOP_N = 20;

export const TopList = ({tree, metric}) => {
    const {t} = useTranslation('jcr-stats');
    const total = measureOf(tree, metric);
    const rows = flatten(tree)
        .sort((a, b) => measureOf(b, metric) - measureOf(a, metric))
        .slice(0, TOP_N);

    return (
        <div className={styles.js_tableWrap} data-testid="jcrstats-largest">
            <table className={styles.js_table}>
                <thead>
                    <tr>
                        {/* H-4: scope="col" on every th */}
                        <th scope="col">#</th>
                        <th scope="col">{t('label.tableName')}</th>
                        <th scope="col">{t('label.tablePath')}</th>
                        <th scope="col" className={styles.js_num}>{t('label.tableSize')}</th>
                        <th scope="col" className={styles.js_num}>{t('label.tablePctTotal')}</th>
                        <th scope="col" className={styles.js_num}>{t('label.tableNodes')}</th>
                        {/* H-4: empty action column gets sr-only label */}
                        <th scope="col"><span className={styles.js_sr_only}>{t('label.actions')}</span></th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, index) => (
                        <tr key={row.path || index}>
                            <td>{index + 1}</td>
                            <td>{row.name}</td>
                            <td className={styles.js_path}>{row.path}</td>
                            <td className={styles.js_num}>{formatBytes(row.size)}</td>
                            <td className={styles.js_num}>{percent(measureOf(row, metric), total).toFixed(1)}%</td>
                            <td className={styles.js_num}>{row.nodeCount}</td>
                            <td>
                                <JContentLink path={row.path}/>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};
