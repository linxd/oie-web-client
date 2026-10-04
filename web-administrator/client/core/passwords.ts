/*
 * Human-readable password-policy hints from the engine's PasswordRequirements
 * (GET /server/passwordRequirements). Field semantics mirror the engine's
 * PasswordRequirementsChecker: for the character-class fields, 0 = no
 * requirement, -1 = must NOT contain, N > 0 = at least N; minLength: 0 = off,
 * N = minimum length. Used to show users the rules up front (the engine remains
 * the authority — checkUserPassword/updateUserPassword enforce them).
 */
import type { OieObject } from './wire-types.js';

export function passwordRequirementHints(req: OieObject | null | undefined): string[] {
    const r: Record<string, unknown> = (req && (req.passwordRequirements || req)) || {};
    const num = (k: string) => { const v = Number(r[k]); return Number.isFinite(v) ? v : 0; };
    const hints: string[] = [];

    const minLength = num('minLength');
    if (minLength > 0) hints.push(`至少 ${minLength} 个字符`);

    const rule = (key: string, noun: string) => {
        const v = num(key);
        if (v === -1) hints.push(`不含${noun}`);
        else if (v === 1) hints.push(`1 个${noun}`);
        else if (v > 1) hints.push(`${v} 个${noun}`);
    };
    rule('minUpper', '大写字母');
    rule('minLower', '小写字母');
    rule('minNumeric', '数字');
    rule('minSpecial', '特殊字符');

    return hints;
}
