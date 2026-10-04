import { confirmDialog } from '@oie/web-ui';
import * as store from '../core/store.js';
import { saveChannelModel } from '../core/channel-save.js';
import { captureEngineSession } from '../core/engine-fetch.js';
import { channelDependencyState, persistLibraryAssociations, persistChannelDependencies } from '../core/channel-dependencies.js';

/** UI continuations must stop quietly when their initiating session has ended. */
export function channelSessionActive(): () => boolean {
    let assertSession: () => void;
    try { assertSession = captureEngineSession(); }
    catch { return () => false; }
    return () => {
        try { assertSession(); return true; }
        catch { return false; }
    };
}

export const confirmLibraryOverwrite = () => confirmDialog('代码模板库已修改',
    '自上次刷新以来，一个或多个代码模板或库已被修改。要覆盖这些更改吗？',
    { danger: true, okLabel: '覆盖' });

export const confirmChannelOverwrite = () => confirmDialog('通道已修改',
    '自您首次打开以来该通道已被修改，或其编辑时间戳无法校验。要用您的更改覆盖已保存的通道吗？',
    { danger: true, okLabel: '覆盖' });

export async function persistChannelModel(channel: any): Promise<boolean> {
    const assertSession = captureEngineSession();
    assertSession();
    const saved = await saveChannelModel(channel, {
        userId: store.getState('user')?.id,
        skipUnchanged: true,
        confirmCreationRetry: () => confirmDialog('创建结果未知',
            '上次的创建请求没有返回结果，且尚看不到该通道，引擎可能仍在处理。要用同一通道 ID 重试创建吗？',
            { danger: true, okLabel: '重试创建' }),
        confirmConflict: confirmChannelOverwrite
    });
    assertSession();
    if (saved) store.setState('editingChannelNew', false);
    return saved;
}

/** Classic/subeditor saves also finish shared writes carried from the wizard. */
export async function persistChannelEdits(channel: any): Promise<boolean> {
    const assertSession = captureEngineSession();
    assertSession();
    const saved = await persistChannelModel(channel);
    assertSession();
    if (!saved) return false;
    const pending = channelDependencyState(channel);
    const version = channel['@version'] || store.getState('serverVersion');
    const librariesSaved = await persistLibraryAssociations(channel, pending.libraries, version, confirmLibraryOverwrite);
    assertSession();
    if (!librariesSaved) return false;
    await persistChannelDependencies(pending.dependencies);
    assertSession();
    return true;
}
