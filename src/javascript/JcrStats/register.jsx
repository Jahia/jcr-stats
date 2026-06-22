import {registry} from '@jahia/ui-extender';
import {JcrStatsAdmin} from './JcrStats';
import React from 'react';

export default () => {
    registry.add('adminRoute', 'jcrStats', {
        targets: ['administration-server-systemHealth:998'],
        requiredPermission: 'jcrStatsAdmin',
        label: 'jcr-stats:label.menu_entry',
        isSelectable: false
    });
    registry.add('adminRoute', 'jcrStatsExecution', {
        targets: ['administration-server-jcrStats:1'],
        requiredPermission: 'jcrStatsAdmin',
        label: 'jcr-stats:label.menu_execution',
        isSelectable: true,
        render: () => React.createElement(JcrStatsAdmin)
    });
};
