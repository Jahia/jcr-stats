import React from 'react';
import {useTranslation} from 'react-i18next';
import {buildJContentUrl} from './jcrStatsUtils';

// DRY: single jContent link used by the flamegraph caption and every table view.
// Renders the same markup so the Cypress selector `jcrstats-largest a[href*="/jahia/jcontent/"]`
// keeps matching: a real <a> with visible "Open in jContent" text. Returns null when the
// path is not linkable (only /sites/<siteKey>/... resolves to a jContent URL).
export const JContentLink = ({path, className}) => {
    const {t} = useTranslation('jcr-stats');
    const url = buildJContentUrl(path);
    if (!url) {
        return null;
    }

    return (
        <a
            className={className}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${t('label.openJContent')} ${t('label.opensNewTab')}`}
        >
            {t('label.openJContent')}
        </a>
    );
};
