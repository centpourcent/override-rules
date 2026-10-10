/*!
powerfullz 的 Substore 订阅转换脚本
https://github.com/powerfullz/override-rules

支持的传入参数：
- grouptype: 地区代理组类型（0=select 手动选择, 1=url-test 自动测速, 2=load-balance 负载均衡，默认 0）
  - 向后兼容：若未传 grouptype 但传了 loadbalance，则 loadbalance=true 映射为 grouptype=2，loadbalance=false 映射为 grouptype=1
- landing: auto-detected from nodes with `dialer-proxy` field; no user parameter needed
- ipv6: 启用 IPv6 支持（默认 false）
- tun: 启用 TUN 模式（默认 false）
- full: 输出完整配置（适合纯内核启动，默认 false）
- keepalive: 启用 tcp-keep-alive（默认 false）
- fakeip: DNS 使用 FakeIP 模式（默认 true；传 false 时为 RedirHost）
- quic: 允许 QUIC 流量（UDP 443，默认 false）
- threshold: 地区节点数量小于该值时不显示分组 (默认 0)
- regex: 使用正则过滤模式（include-all + filter）写入各地区代理组，而非直接枚举节点名称（默认 false）
- inlinelanding: 将其他代理组中对「落地节点」组的引用展开为具体的落地节点名称（默认 false）
- splitproviders: 按订阅提供商拆分地区代理组，逗号分隔的提供商名称（默认空，功能关闭）
- globalgroup: 是否在配置中定义 GLOBAL 代理组（默认 true；传 false 时不定义，由内核使用其内置 GLOBAL）

源码已迁移至 `src/*.ts`。
*/

import { CDN_URL, PROXY_GROUPS } from "./constants";
import { buildFeatureFlags } from "./args";
import { buildProxyGroups } from "./proxy_groups";
import {
    getActiveCountryNames,
    parseCountries,
    parseLowCost,
    parseNodesByLanding,
    parseTailscale,
} from "./node_parser";
import { buildRules } from "./rules";
import { ruleProviders } from "./rule_providers";
import { buildDns, snifferConfig } from "./dns";
import { buildTunConfig } from "./tun";
import { buildBaseLists, buildCountryGroupPlans, getCountryGroupNames } from "./selectors";
import { isNotNull } from "./utils";
import type { ClashConfig, ProxyGroup, ProxyNode, ScriptArgs } from "./types";

const geoxURL = {
    geoip: `${CDN_URL}/gh/MetaCubeX/meta-rules-dat@release/geoip.dat`,
    geosite: `${CDN_URL}/gh/MetaCubeX/meta-rules-dat@release/geosite.dat`,
    mmdb: `${CDN_URL}/gh/MetaCubeX/meta-rules-dat@release/country.mmdb`,
    asn: `${CDN_URL}/gh/MetaCubeX/meta-rules-dat@release/GeoLite2-ASN.mmdb`,
};

declare const $arguments: ScriptArgs;

function getRawArgs(): ScriptArgs {
    try {
        return $arguments;
    } catch {
        // console.log("[powerfullz 的覆写脚本] 未检测到传入参数，使用默认参数。");
        return {};
    }
}

const rawArgs = getRawArgs();
const {
    groupType,
    ipv6Enabled,
    fullConfig,
    keepAliveEnabled,
    fakeIPEnabled,
    quicEnabled,
    regexFilter,
    inlineLandingEnabled,
    splitProviders,
    globalGroupEnabled,
    tunEnabled,
    countryThreshold,
} = buildFeatureFlags(rawArgs);

/**
 * 将其他代理组中对「落地节点」组的引用展开为具体的落地节点名称。
 * 展开后除「落地节点」组本身外，不再有任何代理组引用该组。
 *
 * GLOBAL 组会被跳过：它的 proxies 列表同时充当 web 面板与部分客户端的
 * 代理组排序表（https://wiki.metacubex.one/config/proxy-groups/built-in/ ），
 * 官方要求列全所有代理组。若其中某一项被展开掉，对应代理组就会从排序表中
 * 消失，在 Clash Verge Rev 等客户端里被排到列表最前。
 * @param groups - 已构建完成的代理组列表（须已包含 GLOBAL 组）
 * @param landingNodes - 落地节点数组，名称按其原顺序插入引用所在位置
 */
function expandLandingGroupReferences(groups: ProxyGroup[], landingNodes: ProxyNode[]): void {
    const landingNames = landingNodes.map((node) => node.name).filter(isNotNull);
    if (landingNames.length === 0) return;

    for (const group of groups) {
        if (
            group.name === PROXY_GROUPS.LANDING ||
            group.name === PROXY_GROUPS.GLOBAL ||
            !Array.isArray(group.proxies)
        ) {
            continue;
        }
        // 赋新数组而非原地修改：多个代理组共享同一份基础列表实例
        group.proxies = group.proxies.flatMap((name) =>
            name === PROXY_GROUPS.LANDING ? landingNames : name
        );
    }
}

function main(config: ClashConfig): ClashConfig {
    if (!config.proxies || !Array.isArray(config.proxies)) {
        throw new Error("[powerfullz 的覆写脚本] 错误：Clash 配置中缺少有效的 proxies 字段");
    }
    const { landingNodes, nonLandingNodes } = parseNodesByLanding(config.proxies);
    const landing = landingNodes.length > 0 && nonLandingNodes.length > 0;
    const countryNodes = parseCountries(landing ? nonLandingNodes : config.proxies);
    const lowCostNodes = parseLowCost(landing ? nonLandingNodes : config.proxies);
    const countryNames = getActiveCountryNames(countryNodes, countryThreshold);
    const countryGroupPlans = buildCountryGroupPlans({
        countryNames,
        countryNodes,
        splitProviders,
    });
    const countryGroupNames = countryGroupPlans.flatMap((plan) => getCountryGroupNames(plan));
    const allNodes = config.proxies.map((node) => node.name);
    const tailscaleNodes = parseTailscale(config.proxies);
    const hasTailscale = tailscaleNodes.length > 0;

    const {
        defaultProxies,
        defaultProxiesDirect,
        defaultSelector,
        defaultFallback,
        frontProxySelector,
    } = buildBaseLists({
        landing,
        lowCostNodes,
        countryGroupNames,
        nonLandingNodes,
        regexFilter,
    });

    const proxyGroups = buildProxyGroups({
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
    });

    if (globalGroupEnabled) {
        const globalProxies = proxyGroups.map((item) => String(item.name));
        proxyGroups.push({
            name: PROXY_GROUPS.GLOBAL,
            icon: `${CDN_URL}/gh/Koolson/Qure@master/IconSet/Color/Global.png`,
            "include-all": true,
            type: "select",
            proxies: globalProxies,
        });
    }

    if (inlineLandingEnabled) {
        expandLandingGroupReferences(proxyGroups, landingNodes);
    }

    const finalRules = buildRules({ quicEnabled }, hasTailscale);

    return {
        proxies: config.proxies,
        ...(config.hosts !== undefined && { hosts: config.hosts }),
        ...(fullConfig && {
            "mixed-port": 7890,
            "redir-port": 7892,
            "tproxy-port": 7893,
            "routing-mark": 7894,
            "allow-lan": true,
            "bind-address": "*",
            ipv6: ipv6Enabled,
            mode: "rule",
            "unified-delay": true,
            "tcp-concurrent": true,
            "find-process-mode": "off",
            "log-level": "info",
            "geodata-loader": "standard",
            "external-controller": ":9999",
            "disable-keep-alive": !keepAliveEnabled,
            profile: { "store-selected": true },
        }),
        "proxy-groups": proxyGroups,
        "rule-providers": ruleProviders,
        rules: finalRules,
        sniffer: snifferConfig,
        dns: buildDns({ fakeIPEnabled, ipv6Enabled, upstreamDns: config.dns }),
        tun: buildTunConfig(tunEnabled, hasTailscale),
        "geodata-mode": true,
        "geox-url": geoxURL,
    };
}

(globalThis as Record<string, unknown>).main = main;
