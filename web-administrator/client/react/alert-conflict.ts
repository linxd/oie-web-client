/*
 * Alerts have NO engine-side conflict detection (no revision field, no override
 * check in AlertController — unlike channels and code templates). This web
 * safety check goes beyond Swing: snapshot
 * the server's copy when editing begins, re-fetch just before saving, and prompt
 * when they differ. The small fetch-to-save race is accepted — it is strictly
 * better than the silent last-write-wins it replaces.
 */

import api from '@oie/web-api';
import { confirmDialog } from '@oie/web-ui';

// The baseline follows the working object's identity across classic/wizard
// handoffs. Never fetch a second copy after editing has already begun.
const baselines = new WeakMap<object, string>();
export async function loadAlertForEdit(alertId: string) {
    const model = await api.alerts.get(alertId);
    if (!model || model.id !== alertId) throw new Error('未找到警报');
    baselines.set(model, JSON.stringify(model));
    return model;
}

export function alertBaseline(model: object): string | null {
    return baselines.get(model) ?? null;
}

/**
 * True when it is OK to save: the alert is unchanged on the server, or the user
 * explicitly chose to overwrite. An unavailable baseline or current read must
 * not silently disable conflict checking.
 */
export async function confirmIfAlertChanged(alertId: any, baseline: any) {
    if (!baseline) throw new Error('无法校验原始警报，请重新打开后再保存');
    const model = await api.alerts.get(alertId);
    if (!model || model.id !== alertId) throw new Error('该警报已被删除，请重新打开警报列表后再保存');
    const current = JSON.stringify(model);
    if (current === baseline) return true;
    return confirmDialog('警报已被修改',
        '自您打开该警报后它已被修改，确定要覆盖吗？',
        { danger: true, okLabel: '覆盖' });
}
