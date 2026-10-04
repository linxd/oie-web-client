import { checkbox, h, modal, promptDialog, toast } from '@oie/web-ui';
import api from '@oie/web-api';
import { platform } from '@oie/web-shell';
import { getPref } from '../core/prefs.js';

export interface RemoveAllMessagesChannel {
    channelId: string;
    name?: string;
    state?: string | null;
}

export interface RemoveAllMessagesDialogOptions {
    channels: RemoveAllMessagesChannel[];
    onDone?: () => void | Promise<void>;
}

/**
 * Swing-parity RemoveMessagesDialog shared by the dashboard and message browser.
 * Running channels are opt-in; when included, the engine stops them, removes
 * their messages, and restores the connectors that were active beforehand.
 */
export function openRemoveAllMessagesDialog({ channels, onDone }: RemoveAllMessagesDialogOptions): void {
    const selected = channels.filter(channel => channel?.channelId);
    if (!selected.length) {
        toast('请先选择通道', 'warn');
        return;
    }

    const stateOf = (channel: RemoveAllMessagesChannel) =>
        channel.state ? String(channel.state).toUpperCase() : null;
    const running = selected.filter(channel => {
        const state = stateOf(channel);
        return state !== null && state !== 'STOPPED';
    });
    const canClearStatistics = platform.checkTask('dashboard', 'doClearStats');
    const includeRunning = checkbox(
        '包含未停止的所选通道（移除消息期间会临时停止它们）',
        false,
        { disabled: running.length === 0 }
    );
    const clearStatistics = checkbox(
        '清除受影响通道的统计',
        canClearStatistics,
        { disabled: !canClearStatistics }
    );
    const scope = selected.length === 1 && selected[0].name
        ? `通道 ${selected[0].name}`
        : `${selected.length} 个所选通道`;

    modal({
        title: '移除全部消息',
        body: h('div',
            h('div.mb-[13px]',
                `确定要永久移除${scope}的全部消息（含已排队消息）吗？此操作无法撤销`),
            h('div', { class: 'flex flex-col gap-1.5' }, includeRunning.el, clearStatistics.el),
            running.length
                ? h('div.hint.mt-[13px]', running.length === 1
                    ? `有 1 个所选通道当前为 ${stateOf(running[0])}，勾选第一项可将其包含在内`
                    : `有 ${running.length} 个所选通道未停止，勾选第一项可将它们包含在内`)
                : null,
            !canClearStatistics
                ? h('div.hint.mt-[13px]', '您没有清除仪表盘统计的权限')
                : null),
        buttons: [
            { label: '取消' },
            {
                label: '全部移除', danger: true,
                onClick: async () => {
                    const shouldIncludeRunning = includeRunning.input.checked;
                    const targets = shouldIncludeRunning
                        ? selected
                        : selected.filter(channel => !running.includes(channel));

                    // A single running channel with the safe default left in
                    // place is a guaranteed no-op. Keep the options open instead
                    // of repeating the old false-success behavior.
                    if (!targets.length) {
                        toast('请勾选包含运行中通道的选项，或先停止所选通道', 'warn');
                        return false;
                    }

                    if (getPref('confirmReprocessRemove') !== false) {
                        const text = await promptDialog('移除全部消息',
                            `这将移除 ${targets.length} 个通道的全部消息。输入 REMOVEALL 以继续`);
                        if (text === null) return false;
                        if (text !== 'REMOVEALL') {
                            toast('必须输入 REMOVEALL 才能移除全部消息', 'warn');
                            return false;
                        }
                    }

                    const failures: Array<{ channel: RemoveAllMessagesChannel; error: any }> = [];
                    for (const channel of targets) {
                        try {
                            await api.messages.removeAll(
                                channel.channelId,
                                shouldIncludeRunning,
                                clearStatistics.input.checked
                            );
                        } catch (error: any) {
                            failures.push({ channel, error });
                        }
                    }

                    await onDone?.();
                    if (failures.length) {
                        const failed = failures.map(({ channel }) => channel.name || channel.channelId).join(', ');
                        const details = failures.map(({ error }) => error?.message || String(error)).join('; ');
                        toast(`全部移除失败（${failed}）：${details}`, 'error');
                        return;
                    }

                    const skipped = selected.length - targets.length;
                    const result = targets.length === 1 ? '已移除全部消息' : `已从 ${targets.length} 个通道移除消息`;
                    toast(skipped
                        ? `${result}；已跳过 ${skipped} 个运行中的通道`
                        : result);
                }
            }
        ]
    });
}
