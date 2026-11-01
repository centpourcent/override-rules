/**
 * 最终配置组装：将节点、代理组、规则、DNS、TUN、Geo 数据源及上游字段拼装为最终 `ClashConfig`。
 */

import { PROXY_GROUPS } from "../catalog/group-names";
import { ICONS } from "../catalog/icons";
import { adblockAlternatives, ruleSets } from "../catalog/rule-sets";
import { buildDns } from "./dns";
import { buildFullConfig } from "./full-config";
import { geoxUrl } from "./geox";
import { buildRules } from "./rules";
import { snifferConfig } from "./sniffer";
import { buildTunConfig } from "./tun";
import type { FeatureFlags } from "../types/args";
import type { ClashConfig } from "../types/clash";
import type { NodeAnalysis, ProxyGroup, ProxyNode } from "../types/proxy";

/**
 * 追加 GLOBAL 代理组：其候选为它之前的所有代理组。
 */
function appendGlobalGroup(groups: ProxyGroup[]): ProxyGroup[] {
    const global: ProxyGroup = {
        name: PROXY_GROUPS.GLOBAL,
        icon: ICONS.global,
        "include-all": true,
        type: "select",
        proxies: groups.map((group) => String(group.name)),
    };

    return [...groups, global];
}

/**
 * 将其他代理组中对「落地节点」组的引用展开为具体的落地节点名称。
 *
 * GLOBAL 组会被跳过：它的 proxies 同时充当 web 面板与部分客户端的代理组排序表，
 * 若其中某一项被展开掉，对应代理组就会从排序表中消失，在 Clash Verge Rev 等客户端里
 * 被排到列表最前。
 * @param groups - 已构建完成的代理组列表
 * @param landingNodes - 落地节点数组，名称按其原顺序插入引用所在位置
 */
function expandLandingReferences(groups: ProxyGroup[], landingNodes: ProxyNode[]): ProxyGroup[] {
    const landingNames = landingNodes.map((node) => node.name);
    if (landingNames.length === 0) return groups;

    return groups.map((group) => {
        if (
            group.name === PROXY_GROUPS.LANDING ||
            group.name === PROXY_GROUPS.GLOBAL ||
            !group.proxies
        ) {
            return group;
        }

        return {
            ...group,
            proxies: group.proxies.flatMap((name) =>
                name === PROXY_GROUPS.LANDING ? landingNames : name
            ),
        };
    });
}

/** 组装最终配置所需的上下文数据。 */
export interface AssembleConfigInput {
    flags: FeatureFlags;
    nodes: NodeAnalysis;
    proxyGroups: ProxyGroup[];
}

/** 对已构建的代理组执行收尾处理：追加 GLOBAL，并按开关展开落地节点引用。 */
function finalizeProxyGroups({ flags, nodes, proxyGroups }: AssembleConfigInput): ProxyGroup[] {
    const groups = appendGlobalGroup(proxyGroups);
    return flags.inlineLandingEnabled
        ? expandLandingReferences(groups, nodes.landingNodes)
        : groups;
}

/**
 * 将各部分拼装为最终配置。
 *
 * 上游 `hosts` 始终保留；`full=true` 时追加完整内核参数；
 * DNS 会按字段规则继承上游配置。
 * @param config - 上游订阅配置
 * @param input - 组装上下文
 */
export function assembleConfig(
    config: ClashConfig,
    { flags, nodes, proxyGroups }: AssembleConfigInput
): ClashConfig {
    const { ADBlock, AdditionalFilter, ...baseRuleSets } = ruleSets;
    type AdblockProvider =
        typeof ADBlock | (typeof adblockAlternatives)[keyof typeof adblockAlternatives];
    let adblockProvider: AdblockProvider | undefined;
    if (flags.adblockSource === 2) {
        adblockProvider = ADBlock;
    } else if (flags.adblockSource !== 0) {
        adblockProvider = adblockAlternatives[flags.adblockSource];
    }

    return {
        proxies: config.proxies,
        ...(config.hosts !== undefined && { hosts: config.hosts }),
        ...(flags.fullConfig && buildFullConfig(flags)),
        "proxy-groups": finalizeProxyGroups({ flags, nodes, proxyGroups }),
        "rule-providers": {
            ...baseRuleSets,
            ...(adblockProvider && { ADBlock: adblockProvider, AdditionalFilter }),
        },
        rules: buildRules({
            quicEnabled: flags.quicEnabled,
            hasTailscale: nodes.hasTailscale,
            adblockSource: flags.adblockSource,
        }),
        sniffer: snifferConfig,
        dns: buildDns({
            fakeIPEnabled: flags.fakeIPEnabled,
            ipv6Enabled: flags.ipv6Enabled,
            upstreamDns: config.dns,
        }),
        tun: buildTunConfig(flags.tunEnabled, nodes.hasTailscale),
        "geodata-mode": true,
        "geox-url": geoxUrl,
    };
}
