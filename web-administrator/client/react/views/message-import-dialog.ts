import { checkbox, h, modal, select } from '@oie/web-ui';
import { pickMessageFiles } from '../../core/message-import-files.js';

export type MessageImportSource = { recursive: boolean } & ({ path: string } | { files: File[] });

export function messageImportDialog(assertSession: () => void): Promise<MessageImportSource | null> {
    return new Promise(resolve => {
        const source = select([
            { value: 'files', label: '本机 — 文件或归档' },
            { value: 'folder', label: '本机 — 文件夹' },
            { value: 'server', label: '服务器' }
        ], 'files', { 'aria-label': '导入来源', onChange: () => { path.disabled = source.value !== 'server'; } });
        const path = h('input', { type: 'text', disabled: true, 'aria-label': '服务器文件/文件夹/归档' }) as HTMLInputElement;
        const recursive = checkbox('包含子文件夹', true);
        const error = h('div', { role: 'alert' });
        modal({
            title: '导入消息',
            body: h('div', { class: 'flex flex-col gap-3' },
                h('label', '导入来源', source),
                h('label', '服务器文件/文件夹/归档', path), recursive.el,
                h('p', '已接收、已排队或待处理的消息将在导入后被置为错误'), error),
            onClose: () => resolve(null),
            buttons: [
                { label: '取消', onClick: () => resolve(null) },
                { label: '导入', primary: true, onClick: async () => {
                    try {
                        assertSession();
                        if (source.value === 'server') {
                            if (!path.value.trim()) { error.textContent = '请输入要导入的文件/文件夹'; return false; }
                            resolve({ path: path.value, recursive: recursive.input.checked });
                        } else {
                            const files = await pickMessageFiles(source.value === 'folder');
                            assertSession();
                            if (!files) return false;
                            resolve({ files, recursive: recursive.input.checked });
                        }
                    } catch {
                        resolve(null);
                    }
                } }
            ]
        });
    });
}
