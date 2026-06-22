import {registry} from '@jahia/ui-extender';
import register from './JcrStats/register';
import i18next from 'i18next';

export default function () {
    registry.add('callback', 'jcr-stats', {
        targets: ['jahiaApp-init:50'],
        callback: async () => {
            await i18next.loadNamespaces('jcr-stats');
            register();
        }
    });
}
