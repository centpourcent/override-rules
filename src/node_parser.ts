import { LOW_COST_NODE_MATCHER, countriesMeta } from "./constants";
import { createCaseInsensitiveNodeMatcher, escapeRegExp } from "./utils";
import type {
    CaseInsensitiveNodeMatcher,
    ProviderNodeGroup,
    ProviderPartition,
    ProxyNode,
} from "./types";

const COUNTRY_REGEX_MAP = Object.fromEntries(
    Object.entries(countriesMeta).map(([country, meta]) => {
        return [country, new RegExp(meta.pattern.replace(/^\(\?i\)/, ""))];
    })
) as Record<string, RegExp>;

const COUNTRY_EXCLUDE_MAP = Object.fromEntries(
    Object.entries(countriesMeta)
        .filter(([, meta]) => meta.excludePattern)
        .map(([country, meta]) => [country, new RegExp(meta.excludePattern!)])
) as Record<string, RegExp>;

/**
 * 从 Clash 配置中筛选出所有 Tailscale 节点。
 * @param config - 当前的 Clash 配置对象，需包含 `proxies` 字段
 * @returns Tailscale 节点数组
 */
export function parseTailscale(nodes: ProxyNode[]): ProxyNode[] {
    return (nodes || []).filter((proxy) => proxy.type === "tailscale" || false);
}

/**
 * 从 Clash 配置中筛选出所有低价节点的名称。
 * @param config - 当前的 Clash 配置对象，需包含 `proxies` 字段
 * @returns 匹配低价节点正则的节点数组
 */
export function parseLowCost(nodes: ProxyNode[]): ProxyNode[] {
    return (nodes || []).filter((proxy) => LOW_COST_NODE_MATCHER.regex.test(proxy.name || ""));
}

/**
 * 根据 dialer-proxy 字段将节点分为落地节点和非落地节点。
 * 在 Mihomo 链式代理中，`dialer-proxy` 表示当前节点通过指定代理拨号。
 * 因此带 `dialer-proxy: "前置代理"` 的节点是落地节点（目标节点），其余为非落地节点。
 * @param nodes - 节点数组，一般是 `config.proxies` 列表
 * @returns 包含 `landingNodes`（带 dialer-proxy 的落地节点）和 `nonLandingNodes`（普通/中继节点）
 */
export function parseNodesByLanding(nodes: ProxyNode[]): {
    landingNodes: ProxyNode[];
    nonLandingNodes: ProxyNode[];
} {
    const landingNodes: ProxyNode[] = [];
    const nonLandingNodes: ProxyNode[] = [];

    for (const node of nodes || []) {
        const name = node.name;

        if (!name) continue;

        if (node["dialer-proxy"] === "前置代理") {
            landingNodes.push(node);
        } else {
            nonLandingNodes.push(node);
        }
    }

    return { landingNodes, nonLandingNodes };
}

/**
 * 遍历订阅中的所有节点，按 `countriesMeta` 中定义的地区进行归类。
 * 排除匹配 COUNTRY_EXCLUDE_MAP[country] 的节点。
 * @param nodes - 节点数组，当链式代理激活时为 nonLandingNodes，否则为全部节点
 * @returns 地区名到节点数组的映射 Record
 */
export function parseCountries(nodes: ProxyNode[]): Record<string, ProxyNode[]> {
    const countryNodes: Record<string, ProxyNode[]> = Object.create(null);

    for (const node of nodes) {
        const name = node.name || "";

        for (const [country, regex] of Object.entries(COUNTRY_REGEX_MAP)) {
            if (!regex.test(name)) continue;
            if (COUNTRY_EXCLUDE_MAP[country]?.test(name)) continue;

            if (!countryNodes[country]) {
                countryNodes[country] = [];
            }
            countryNodes[country].push(node);
            break;
        }
    }

    return countryNodes;
}

/**
 * 根据最小节点数量阈值过滤地区，并按权重排序后返回地区名称列表。
 * @param countryNodes - 由 `parseCountries` 返回的地区名到节点数组的映射
 * @param minCount - 地区节点数量的最小阈值，节点数不足该值的地区将被过滤掉
 * @returns 按权重排序的地区名数组（不含后缀）
 */
export function getActiveCountryNames(
    countryNodes: Record<string, ProxyNode[]>,
    minCount: number
): string[] {
    const filtered = Object.entries(countryNodes).filter(([, nodes]) => nodes.length >= minCount);

    filtered.sort(([a], [b]) => {
        const wa = countriesMeta[a]?.weight ?? Infinity;
        const wb = countriesMeta[b]?.weight ?? Infinity;
        return wa - wb;
    });

    return filtered.map(([country]) => country);
}

/**
 * 创建单个提供商的词边界匹配器。
 * 名称两侧必须是空白、`-` 或字符串首尾，因此 `aaaCloud` 不会匹配 `aaaCloudPlus`。
 * @description 不使用 `\b`：其在 JS（仅 ASCII）与 Mihomo 的 .NET 风格引擎（Unicode）下语义不同。
 * 返回的 `source` 可直接并入 Mihomo 的 `exclude-filter`。
 * @param provider - 提供商名称
 * @returns 大小写不敏感的匹配器对象
 */
export function createProviderMatcher(provider: string): CaseInsensitiveNodeMatcher {
    return createCaseInsensitiveNodeMatcher(
        String.raw`(?:^|[\s\-])${escapeRegExp(provider)}(?:[\s\-]|$)`
    );
}

/**
 * 按大小写不敏感去重提供商名称，保留首次出现的拼写。
 * @description 防止 `aaaCloud,AAACLOUD` 生成两个同名分组。
 * @param providers - 原始提供商名称列表
 * @returns 去重后的提供商名称列表
 */
export function getUniqueProviders(providers: string[]): string[] {
    const seen = new Set<string>();
    return providers.filter((provider) => {
        const key = provider.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * 将节点按所配置的提供商归类。
 * @description 采用独立匹配而非首个命中即止：一个节点可同时归属多个提供商，
 * 因此结果与 `providers` 的书写顺序无关。只返回含节点的分组。
 * @param nodes - 待归类的节点数组
 * @param providers - 已配置的提供商名称列表
 * @returns 各提供商的分组，以及未被任何提供商匹配的剩余节点
 */
export function partitionNodesByProvider(
    nodes: ProxyNode[],
    providers: string[]
): ProviderPartition {
    const uniqueProviders = getUniqueProviders(providers);
    const matchers = uniqueProviders.map((provider) => createProviderMatcher(provider).regex);
    const groups: ProviderNodeGroup[] = uniqueProviders.map((provider) => ({
        provider,
        nodes: [],
    }));
    const rest: ProxyNode[] = [];

    for (const node of nodes) {
        const name = node.name || "";
        const matched = groups.filter((_, index) => matchers[index].test(name));

        if (matched.length === 0) {
            rest.push(node);
            continue;
        }

        for (const group of matched) {
            group.nodes.push(node);
        }
    }

    return { groups: groups.filter((group) => group.nodes.length > 0), rest };
}
