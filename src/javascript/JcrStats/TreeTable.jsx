import React, {useState} from 'react';
import {useTranslation} from 'react-i18next';
import styles from './JcrStats.scss';
import {formatBytes, measureOf, percent, buildJContentUrl} from './jcrStatsUtils';

const INDENT_PX = 16;

const TreeRow = ({node, metric, total, parentMeasure, depth}) => {
    const [open, setOpen] = useState(depth < 1); // root's direct children expanded by default
    const children = node.children || [];
    const hasChildren = children.length > 0;
    const measure = measureOf(node, metric);
    const url = buildJContentUrl(node.path);

    return (
        <>
            <tr>
                <td>
                    <span style={{paddingLeft: `${depth * INDENT_PX}px`}} className={styles.js_treeName}>
                        {hasChildren ? (
                            <button
                                type="button"
                                className={styles.js_treeToggle}
                                aria-expanded={open}
                                onClick={() => setOpen(prev => !prev)}
                            >
                                {open ? '▾' : '▸'}
                            </button>
                        ) : <span className={styles.js_treeSpacer}/>}
                        {node.name}
                    </span>
                </td>
                <td className={styles.js_num}>{formatBytes(Number(node.size))}</td>
                <td className={styles.js_num}>{percent(measure, total).toFixed(1)}%</td>
                <td className={styles.js_num}>{percent(measure, parentMeasure).toFixed(1)}%</td>
                <td className={styles.js_num}>{Number(node.nodeCount) || 0}</td>
                <td>{url && <a href={url} target="_blank" rel="noopener noreferrer">↗</a>}</td>
            </tr>
            {open && children.map(child => (
                <TreeRow
                    key={child.path || child.name}
                    node={child}
                    metric={metric}
                    total={total}
                    parentMeasure={measure}
                    depth={depth + 1}
                />
            ))}
        </>
    );
};

export const TreeTable = ({tree, metric}) => {
    const {t} = useTranslation('jcr-stats');
    const total = measureOf(tree, metric);
    return (
        <div className={styles.js_tableWrap} data-testid="jcrstats-table">
            <table className={styles.js_table}>
                <thead>
                    <tr>
                        <th>{t('label.tableName')}</th>
                        <th className={styles.js_num}>{t('label.tableSize')}</th>
                        <th className={styles.js_num}>{t('label.tablePctTotal')}</th>
                        <th className={styles.js_num}>{t('label.tablePctParent')}</th>
                        <th className={styles.js_num}>{t('label.tableNodes')}</th>
                        <th/>
                    </tr>
                </thead>
                <tbody>
                    <TreeRow node={tree} metric={metric} total={total} parentMeasure={total} depth={0}/>
                </tbody>
            </table>
        </div>
    );
};
