import {
    CDN_URL,
    SPEEDTEST_URL,
    LOW_COST_NODE_MATCHER,
    PROXY_GROUPS,
    countriesMeta,
} from "./constants";
import { createProviderMatcher, getUniqueProviders } from "./node_parser";
import { getCountryGroupNames } from "./selectors";
import { buildList, isNotNull } from "./utils";
import type { BuildProxyGroupsInput, GroupType, ProxyGroup } from "./types";

interface BuildGroupByTypeInput {
    name: string;
    icon: string;
    groupType: GroupType;
    nodeSource: Pick<ProxyGroup, "proxies" | "include-all" | "filter" | "exclude-filter">;
}

/**
 * 根据代理组类型生成对应的代理组配置。
 * 将 groupType 映射为具体的类型字段（select/url-test/load-balance），
 * 并与节点来源字段合并，消除各处重复的 switch 逻辑。
 */
function buildGroupByType({
    name,
    icon,
    groupType,
    nodeSource,
}: BuildGroupByTypeInput): ProxyGroup {
    switch (groupType) {
        case 0:
            return { name, icon, type: "select", ...nodeSource };
        case 1:
            return {
                name,
                icon,
                type: "url-test",
                url: SPEEDTEST_URL,
                interval: 60,
                tolerance: 20,
                ...nodeSource,
            };
        case 2:
            return {
                name,
                icon,
                type: "load-balance",
                strategy: "sticky-sessions",
                url: SPEEDTEST_URL,
                interval: 60,
                tolerance: 20,
                ...nodeSource,
            };
    }
}

/**
 * 构建地区基础分组在正则模式下的 exclude-filter。
 * @description 在保留 countriesMeta.excludePattern 的基础上追加提供商的词边界匹配源，
 * 使基础分组只保留未被任何所配置提供商占用的节点。`|` 结合优先级最低，无需额外分组。
 * 未配置提供商时原样返回 excludePattern，保证功能关闭时产物与改动前逐字节一致。
 * @param excludePattern - countriesMeta 中定义的地区排除模式（可选）
 * @param providerSource - 已配置提供商的匹配源（多个以 `|` 交替），功能关闭时为空字符串
 * @returns 供 Mihomo `exclude-filter` 使用的正则字符串；无需排除时返回空字符串
 */
function buildCountryExcludeFilter(
    excludePattern: string | undefined,
    providerSource: string
): string {
    if (!providerSource) return excludePattern ?? "";

    const parts = buildList(excludePattern, providerSource);
    return `(?i)${parts.join("|")}`;
}

/**
 * 生成所有代理组配置，包含内联的国家地区代理组。
 * @param input - 构建代理组所需的输入参数（详见 BuildProxyGroupsInput）
 * @returns 代理组配置数组
 */
export function buildProxyGroups({
    allNodes,
    regexFilter,
    groupType,
    countryGroupPlans,
    splitProviders,
    lowCostNodes,
    tailscaleNodes,
    landing,
    landingNodes,
    defaultProxies,
    defaultProxiesDirect,
    defaultSelector,
    defaultFallback,
    frontProxySelector,
}: BuildProxyGroupsInput): ProxyGroup[] {
    const providerSource = getUniqueProviders(splitProviders)
        .map((provider) => createProviderMatcher(provider).source)
        .join("|");
    // 取某地区实际会生成的代理组名（含提供商子分组）；基础分组为空时不含基础分组名，
    // 因此下方引用地区分组的组不会产生悬空引用
    const groupNamesOf = (country: string): string[] => {
        const plan = countryGroupPlans.find((item) => item.country === country);
        return plan ? getCountryGroupNames(plan) : [];
    };
    const twGroups = groupNamesOf("台湾");
    const hkGroups = groupNamesOf("香港");
    const usGroups = groupNamesOf("美国");
    const hasTailscale = tailscaleNodes.length > 0;
    const groups: Array<ProxyGroup | null> = [
        {
            name: PROXY_GROUPS.SELECT,
            icon: `${CDN_URL}/gh/Koolson/Qure@master/IconSet/Color/Proxy.png`,
            type: "select",
            proxies: defaultSelector,
        },
        {
            name: PROXY_GROUPS.MANUAL,
            icon: `${CDN_URL}/gh/shindgewongxj/WHATSINStash@master/icon/select.png`,
            type: "select",
            proxies: allNodes,
        },
        landing
            ? {
                  name: PROXY_GROUPS.FRONT_PROXY,
                  icon: `${CDN_URL}/gh/Koolson/Qure@master/IconSet/Color/Area.png`,
                  type: "select",
                  proxies: frontProxySelector,
              }
            : null,
        landing
            ? {
                  name: PROXY_GROUPS.LANDING,
                  icon: `${CDN_URL}/gh/Koolson/Qure@master/IconSet/Color/Airport.png`,
                  type: "select",
                  proxies: landingNodes.map((node) => node.name).filter(isNotNull),
              }
            : null,
        {
            name: PROXY_GROUPS.STATIC_RESOURCES,
            icon: `${CDN_URL}/gh/Koolson/Qure@master/IconSet/Color/Cloudflare.png`,
            type: "select",
            proxies: defaultProxies,
        },
        {
            name: PROXY_GROUPS.AI_SERVICE,
            icon: `${CDN_URL}/gh/Koolson/Qure@master/IconSet/Color/ChatGPT.png`,
            type: "select",
            proxies: defaultProxies,
        },
        {
            name: PROXY_GROUPS.CRYPTO,
            icon: `${CDN_URL}/gh/Koolson/Qure@master/IconSet/Color/Cryptocurrency_1.png`,
            type: "select",
            proxies: defaultProxies,
        },
        {
            name: PROXY_GROUPS.FINANCE,
            icon: `${CDN_URL}/gh/powerfullz/override-rules@master/icons/Nasdaq.png`,
            type: "select",
            proxies: defaultProxiesDirect,
        },
        {
            name: PROXY_GROUPS.APPLE,
            icon: `${CDN_URL}/gh/Koolson/Qure@master/IconSet/Color/Apple_2.png`,
            type: "select",
            proxies: defaultProxies,
        },
        {
            name: PROXY_GROUPS.GOOGLE,
            icon: `${CDN_URL}/gh/Orz-3/mini@master/Color/Google.png`,
            type: "select",
            proxies: defaultProxies,
        },
        {
            name: PROXY_GROUPS.MICROSOFT,
            icon: `${CDN_URL}/gh/powerfullz/override-rules@master/icons/Microsoft_Copilot.png`,
            type: "select",
            proxies: defaultProxies,
        },
        {
            name: PROXY_GROUPS.XBOX,
            icon: `${CDN_URL}/gh/Koolson/Qure@master/IconSet/Color/Xbox.png`,
            type: "select",
            proxies: defaultProxies,
        },
        {
            name: PROXY_GROUPS.GITHUB,
            icon: `${CDN_URL}/gh/Koolson/Qure@master/IconSet/Color/GitHub.png`,
            type: "select",
            proxies: defaultProxies,
        },
        {
            name: PROXY_GROUPS.BILIBILI,
            icon: `${CDN_URL}/gh/Koolson/Qure@master/IconSet/Color/bilibili.png`,
            type: "select",
            proxies:
                twGroups.length > 0 && hkGroups.length > 0
                    ? buildList("DIRECT", twGroups, hkGroups)
                    : defaultProxiesDirect,
        },
        {
            name: PROXY_GROUPS.BAHAMUT,
            icon: `${CDN_URL}/gh/Koolson/Qure@master/IconSet/Color/Bahamut.png`,
            type: "select",
            proxies:
                twGroups.length > 0
                    ? buildList(twGroups, PROXY_GROUPS.SELECT, PROXY_GROUPS.MANUAL, "DIRECT")
                    : defaultProxies,
        },
        {
            name: PROXY_GROUPS.YOUTUBE,
            icon: `${CDN_URL}/gh/Koolson/Qure@master/IconSet/Color/YouTube.png`,
            type: "select",
            proxies: defaultProxies,
        },
        {
            name: PROXY_GROUPS.TWITCH,
            icon: `${CDN_URL}/gh/Koolson/Qure@master/IconSet/Color/Twitch.png`,
            type: "select",
            proxies: defaultProxies,
        },
        {
            name: PROXY_GROUPS.NETFLIX,
            icon: `${CDN_URL}/gh/Koolson/Qure@master/IconSet/Color/Netflix.png`,
            type: "select",
            proxies: defaultProxies,
        },
        {
            name: PROXY_GROUPS.TIKTOK,
            icon: `${CDN_URL}/gh/Koolson/Qure@master/IconSet/Color/TikTok.png`,
            type: "select",
            proxies: defaultProxies,
        },
        {
            name: PROXY_GROUPS.SPOTIFY,
            icon: `${CDN_URL}/gh/Koolson/Qure@master/IconSet/Color/Spotify.png`,
            type: "select",
            proxies: defaultProxies,
        },
        {
            name: PROXY_GROUPS.TELEGRAM,
            icon: `${CDN_URL}/gh/powerfullz/override-rules@master/icons/Telegram.png`,
            type: "select",
            proxies: defaultProxies,
        },
        {
            name: PROXY_GROUPS.TWITTER,
            icon: `${CDN_URL}/gh/Koolson/Qure@master/IconSet/Color/Twitter.png`,
            type: "select",
            proxies: defaultProxies,
        },
        {
            name: PROXY_GROUPS.WEIBO,
            icon: `${CDN_URL}/gh/Koolson/Qure@master/IconSet/Color/Weibo.png`,
            type: "select",
            "include-all": true,
            proxies: defaultProxiesDirect,
        },
        {
            name: PROXY_GROUPS.TRUTH_SOCIAL,
            icon: `${CDN_URL}/gh/powerfullz/override-rules@master/icons/Truth_Social.png`,
            type: "select",
            proxies:
                usGroups.length > 0
                    ? buildList(usGroups, PROXY_GROUPS.SELECT, PROXY_GROUPS.MANUAL)
                    : defaultProxies,
        },
        {
            name: PROXY_GROUPS.EHENTAI,
            icon: `${CDN_URL}/gh/powerfullz/override-rules@master/icons/Ehentai.png`,
            type: "select",
            proxies: defaultProxies,
        },
        {
            name: PROXY_GROUPS.PIKPAK,
            icon: `${CDN_URL}/gh/powerfullz/override-rules@master/icons/PikPak.png`,
            type: "select",
            proxies: defaultProxies,
        },
        {
            name: PROXY_GROUPS.SOGOU_INPUT,
            icon: `${CDN_URL}/gh/powerfullz/override-rules@master/icons/Sougou.png`,
            type: "select",
            proxies: ["DIRECT", "REJECT"],
        },
        hasTailscale
            ? {
                  name: PROXY_GROUPS.TAILSCALE,
                  icon: `${CDN_URL}/gh/powerfullz/override-rules@master/icons/Tailscale.png`,
                  type: "select",
                  proxies: tailscaleNodes.map((node) => node.name).filter(isNotNull),
              }
            : null,
        {
            name: PROXY_GROUPS.AD_BLOCK,
            icon: `${CDN_URL}/gh/Koolson/Qure@master/IconSet/Color/AdBlack.png`,
            type: "select",
            proxies: ["REJECT", "REJECT-DROP", "DIRECT"],
        },
        {
            name: PROXY_GROUPS.FINAL,
            icon: `${CDN_URL}/gh/Koolson/Qure@master/IconSet/Color/Final.png`,
            type: "select",
            proxies: [PROXY_GROUPS.SELECT, "DIRECT"],
        },
        {
            name: PROXY_GROUPS.AUTO,
            icon: `${CDN_URL}/gh/Koolson/Qure@master/IconSet/Color/Auto.png`,
            type: "url-test",
            url: SPEEDTEST_URL,
            proxies: defaultFallback,
            interval: 60,
            tolerance: 20,
        },
        {
            name: PROXY_GROUPS.FALLBACK,
            icon: `${CDN_URL}/gh/Koolson/Qure@master/IconSet/Color/Available_1.png`,
            type: "fallback",
            url: SPEEDTEST_URL,
            proxies: defaultFallback,
            interval: 60,
            tolerance: 20,
        },
        lowCostNodes.length > 0 || regexFilter
            ? buildGroupByType({
                  name: PROXY_GROUPS.LOW_COST,
                  icon: `${CDN_URL}/gh/Koolson/Qure@master/IconSet/Color/Lab.png`,
                  groupType,
                  nodeSource: !regexFilter
                      ? { proxies: lowCostNodes.map((node) => node.name).filter(isNotNull) }
                      : { "include-all": true as const, filter: LOW_COST_NODE_MATCHER.pattern },
              })
            : null,
        ...countryGroupPlans.flatMap((plan) => {
            const meta = countriesMeta[plan.country];
            if (!meta) return [];

            // 基础分组：正则模式下按正则动态筛选，并排除已配置提供商的节点；
            // 枚举模式下直接列出剩余节点
            const excludeFilter = buildCountryExcludeFilter(meta.excludePattern, providerSource);
            const baseNodeSource: Pick<
                ProxyGroup,
                "proxies" | "include-all" | "filter" | "exclude-filter"
            > = regexFilter
                ? {
                      "include-all": true,
                      filter: meta.pattern,
                      ...(excludeFilter ? { "exclude-filter": excludeFilter } : {}),
                  }
                : { proxies: plan.baseNodes.map((node) => node.name).filter(isNotNull) };

            // 提供商子分组始终显式枚举节点：白名单正则无法表达「同时满足地区与提供商」的交集
            const subGroups = plan.subGroups.map((subGroup) =>
                buildGroupByType({
                    name: subGroup.name,
                    icon: meta.icon,
                    groupType,
                    nodeSource: {
                        proxies: subGroup.nodes.map((node) => node.name).filter(isNotNull),
                    },
                })
            );

            return [
                ...subGroups,
                ...(plan.baseNodes.length > 0
                    ? [
                          buildGroupByType({
                              name: plan.baseName,
                              icon: meta.icon,
                              groupType,
                              nodeSource: baseNodeSource,
                          }),
                      ]
                    : []),
            ];
        }),
    ];

    return groups.filter(isNotNull);
}
