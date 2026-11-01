/**
 * 按订阅提供商拆分地区节点（`splitproviders` 参数）。
 *
 * 每个地区拆分为「各提供商子分组 + 基础分组」，基础分组只保留未被任何所配置提供商匹配的节点。
 */

import { countryGroupName } from "../catalog/group-names";
import { createCaseInsensitiveNodeMatcher, escapeRegExp } from "../utils/regex";
import type { CaseInsensitiveNodeMatcher, CountryProviderSplit, ProxyNode } from "../types/proxy";

/**
 * 创建单个提供商的词边界匹配器。
 *
 * 名称两侧必须是空白、`-` 或字符串首尾，因此 `aaaCloud` 不会匹配 `aaaCloudPlus`。
 * 不使用 `\b`：其在 JS（仅 ASCII）与 Mihomo 的 .NET 风格引擎（Unicode）下语义不同。
 */
function createProviderMatcher(provider: string): CaseInsensitiveNodeMatcher {
    return createCaseInsensitiveNodeMatcher(
        String.raw`(?:^|[\s\-])${escapeRegExp(provider)}(?:[\s\-]|$)`
    );
}

/** 按大小写不敏感去重提供商名称并保留首次出现的拼写，防止生成同名分组。 */
function getUniqueProviders(providers: string[]): string[] {
    const seen = new Set<string>();

    return providers.filter((provider) => {
        const key = provider.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * 拆分单个地区的节点。
 *
 * 各提供商独立匹配而非命中首个即止：一个节点可同时归属多个提供商，
 * 结果与 `providers` 的书写顺序无关。只保留含节点的子分组。
 */
function splitCountry(
    country: string,
    nodes: ProxyNode[],
    providers: string[]
): CountryProviderSplit {
    const matchers = providers.map((provider) => createProviderMatcher(provider).regex);
    const subGroups = providers
        .map((provider, index) => ({
            name: `${countryGroupName(country)}（${provider}）`,
            nodes: nodes.filter((node) => matchers[index].test(node.name)),
        }))
        .filter((subGroup) => subGroup.nodes.length > 0);
    const baseNodes = nodes.filter((node) => !matchers.some((matcher) => matcher.test(node.name)));

    return { subGroups, baseNodes };
}

/**
 * 按提供商拆分各地区的节点。
 * @param countryNames - 通过阈值过滤的地区名（不含后缀）
 * @param countryNodes - 地区名 → 节点数组 的映射
 * @param providers - 需要单独成组的提供商名称
 * @returns 地区名 → 拆分结果 的映射
 */
export function splitCountriesByProvider(
    countryNames: string[],
    countryNodes: Record<string, ProxyNode[]>,
    providers: string[]
): Record<string, CountryProviderSplit> {
    const uniqueProviders = getUniqueProviders(providers);

    return Object.fromEntries(
        countryNames.map((country) => [
            country,
            splitCountry(country, countryNodes[country] ?? [], uniqueProviders),
        ])
    );
}

/**
 * 构造基础分组在正则模式下的 `exclude-filter`，排除所有已配置提供商的节点。
 *
 * 使用 `(?i:...)` 将大小写不敏感限定在这一段内，便于与其他过滤规则拼接。
 * @returns 未配置提供商时返回 `undefined`，保证功能关闭时输出不变。
 */
export function buildProviderExcludeFilter(providers: string[]): string | undefined {
    const sources = getUniqueProviders(providers).map(
        (provider) => createProviderMatcher(provider).source
    );

    return sources.length > 0 ? `(?i:${sources.join("|")})` : undefined;
}
