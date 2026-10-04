import { h, modal, promptDialog } from '@oie/web-ui';
import { uuid } from '@oie/web-api';
import type { LibraryImportCallbacks } from './code-template-import.js';

/** Shared Swing import decisions for standalone templates, libraries and channel bundles. */
export function libraryImportCallbacks(assertSession: () => void, ids: Map<string, string>): LibraryImportCallbacks {
    return {
        resolveConflict: async (kind, name) => {
            assertSession();
            const label = kind === 'library' ? '库' : '代码模板';
            const choice = await new Promise<'overwrite' | 'copy' | 'skip' | null>(resolve => {
                modal({
                    title: `导入${label}冲突`,
                    body: h('div', kind === 'library'
                        ? `库 "${name}" 已存在。要更新其设置并合并其中的模板，还是导入一个独立副本？现有模板会被保留`
                        : `代码模板 "${name}" 已存在。要替换其代码与设置，还是导入一个独立副本？`),
                    onClose: () => resolve(null),
                    buttons: [
                        { label: '取消', onClick: () => resolve(null) },
                        { label: kind === 'library' ? '跳过库' : '保留现有', onClick: () => resolve('skip') },
                        { label: '导入为副本', primary: true, onClick: () => resolve('copy') },
                        { label: '覆盖', danger: true, onClick: () => resolve('overwrite') }
                    ]
                });
            });
            assertSession();
            return choice;
        },
        rename: async (kind, name) => {
            assertSession();
            const label = kind === 'library' ? '库' : '代码模板';
            const renamed = await promptDialog(`导入${label}名称`,
                name ? `"${name}" 已被使用，请输入导入${label.toLowerCase()}的其他名称`
                    : `请输入导入${label.toLowerCase()}的名称`, name ? `${name} (导入)` : '');
            assertSession();
            return renamed;
        },
        newId: key => {
            assertSession();
            if (!ids.has(key)) ids.set(key, uuid());
            return ids.get(key)!;
        }
    };
}
