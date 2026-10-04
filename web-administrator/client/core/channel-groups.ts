import api from './api.js';
import type { ChannelGroup } from './wire-types.js';

/** Swing's guarded save and explicit overwrite choice, applied to a fresh set.
 * Even an approved overwrite must preserve groups added while the prompt was open. */
export async function mutateChannelGroups(
    change: (groups: ChannelGroup[]) => ChannelGroup[], removedIds: string[] = [],
    options: { expectedGroup?: ChannelGroup; confirmOverwrite?: () => Promise<boolean> } = {}
): Promise<boolean> {
    const read = async () => {
        const groups = await api.channelGroups.list();
        if (options.expectedGroup && !groups.some(group => group.id === options.expectedGroup!.id)) {
            throw new Error('该通道组已被删除。请刷新通道列表后再保存。');
        }
        return groups;
    };
    const confirm = async () => {
        if (!options.confirmOverwrite) throw new Error('通道组未保存。请刷新并查看当前通道组后重试；其他管理员可能已修改过。');
        return options.confirmOverwrite();
    };
    let current = await read();
    let override = false;
    if (options.expectedGroup && current.find(group => group.id === options.expectedGroup!.id)?.revision !== options.expectedGroup.revision) {
        if (!await confirm()) return false;
        override = true;
        current = await read();
    }
    let result = await api.channelGroups.bulkUpdate(change(structuredClone(current)), removedIds, override);
    if ((result === false || result === 'false') && !override) {
        if (!await confirm()) return false;
        result = await api.channelGroups.bulkUpdate(change(structuredClone(await read())), removedIds, true);
    }
    if (result !== true && result !== 'true') throw new Error('引擎未确认通道组保存。您的更改仍未保存。');
    return true;
}
