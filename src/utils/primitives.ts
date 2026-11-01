/**
 * 通用基础工具函数。
 */

/**
 * 解析布尔值，支持 boolean、`"true"` 与 `"1"`。
 * @param value - 待解析的原始值
 * @param defaultValue - 当 `value` 为 `undefined` 时的回退值，默认为 `false`
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
 * @param value - 待解析的原始值
 * @param defaultValue - 解析失败时的回退值，默认为 `0`
 */
export function parseNumber(value: unknown, defaultValue = 0): number {
    if (value === null || typeof value === "undefined") {
        return defaultValue;
    }

    // 函数契约就是接受任意用户输入并尽力解析，宽松字符串化是预期行为
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const num = parseInt(String(value), 10);
    return Number.isNaN(num) ? defaultValue : num;
}

/**
 * 解析逗号分隔的列表参数，去除首尾空白、丢弃空项并按原值去重。
 *
 * 兼容 Substore 的两种传参形式：`#a=x,y` 字符串，以及 JSON 哈希中的字符串数组。
 * 未传参或传入布尔值时返回空数组：Substore 会把空值解析为 `true`，不能当成名为 "true" 的列表项。
 * @param value - 待解析的原始值
 */
export function parseList(value: unknown): string[] {
    let items: unknown[] = [];
    if (Array.isArray(value)) {
        items = value;
    } else if (typeof value === "string") {
        items = value.split(",");
    }

    return [...new Set(items.map((item) => String(item).trim()).filter(Boolean))];
}

/**
 * 接受任意数量的元素（包括嵌套数组），展平后过滤掉所有假值（false、null、undefined 等）。
 * @param elements - 任意数量的元素或元素数组，允许混入假值
 */
export function buildList<T>(...elements: Array<T | T[] | false | null | undefined>): T[] {
    return elements.flat().filter(Boolean) as T[];
}

/**
 * 类型谓词：过滤掉 null 值。
 * @param value - 待检查的值
 */
export function isNotNull<T>(value: T | null): value is T {
    return value !== null;
}
