import type { CaseInsensitiveNodeMatcher } from "./types";

/**
 * 解析布尔值，支持 boolean、"true" 和 "1"。
 * @param value - 待解析的原始值，可以是任意类型
 * @param defaultValue - 当 `value` 为 `undefined` 时返回的默认值，默认为 `false`
 * @returns 解析后的布尔值；当 value 为 `true`、`"true"` 或 `"1"` 时返回 `true`，当 value 为 `undefined` 时返回 `defaultValue`，否则返回 `false`
 */
export function parseBool(value: unknown, defaultValue = false): boolean {
    if (typeof value === "undefined") return defaultValue;
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
        return value.toLowerCase() === "true" || value === "1";
    }
    return false;
}

/**
 * 将任意值解析为整数。
 * @description 若值为 `null` 或 `undefined` 则直接返回默认值；若解析结果为 `NaN` 也返回默认值。
 * @param value - 待解析的原始值
 * @param defaultValue - 解析失败时的回退值，默认为 `0`
 * @returns 解析成功时返回对应整数，否则返回 `defaultValue`
 */
export function parseNumber(value: unknown, defaultValue = 0): number {
    if (value === null || typeof value === "undefined") {
        return defaultValue;
    }

    const num = parseInt(String(value), 10);
    return Number.isNaN(num) ? defaultValue : num;
}

/**
 * 接受任意数量的元素（包括嵌套数组），展平后过滤掉所有假值（false、null、undefined 等）。
 * @param elements - 任意数量的元素或元素数组，允许混入假值
 * @returns 展平并过滤假值后的元素数组
 */
export function buildList<T>(...elements: Array<T | T[] | false | null | undefined>): T[] {
    return elements.flat().filter(Boolean) as T[];
}

/**
 * 根据给定的正则源字符串，创建一个大小写不敏感的节点匹配器对象。
 * @param source - 正则表达式源字符串（不含修饰符）
 * @returns 包含原始字符串、编译后的 RegExp 对象以及 Clash `(?i)` 前缀 pattern 的匹配器对象
 */
export function createCaseInsensitiveNodeMatcher(source: string): CaseInsensitiveNodeMatcher {
    return {
        source,
        regex: new RegExp(source, "i"),
        pattern: `(?i)${source}`,
    };
}

/**
 * 类型谓词：过滤掉 null 值，用于替代 `.filter(Boolean) as T[]` 模式。
 * @param v - 待检查的值
 * @returns 若值不为 null 则返回 true
 */
export function isNotNull<T>(v: T | null): v is T {
    return v !== null;
}

/**
 * 解析逗号分隔的列表参数，去除首尾空白、丢弃空项并按原值去重。
 * @description 兼容 Substore 的两种传参形式：`#a=x,y` 字符串，以及 JSON 哈希中的字符串数组。
 * 未传参或传入布尔值时返回空数组——Substore 会把空值解析为 `true`，不能当成名为 "true" 的列表项。
 * @param value - 待解析的原始值，可以是任意类型
 * @returns 去重后的非空字符串数组
 */
export function parseList(value: unknown): string[] {
    const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
    return [...new Set(items.map((item) => String(item).trim()).filter(Boolean))];
}

/**
 * 转义正则表达式元字符，使字符串仅按字面量匹配。
 * @description 不转义 `-`（在字符类之外即为字面量）；反引号无法转义——Mihomo 会把
 * filter/exclude-filter 按反引号拆分为多个正则，含反引号的名称无法表达。
 * @param value - 待转义的字符串
 * @returns 转义后的字符串
 */
export function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
