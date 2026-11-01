import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildFeatureFlags } from "../../src/args/parse";
import { analyzeNodes } from "../../src/analysis/classify";
import { assembleConfig } from "../../src/builders/config";
import { buildProxyGroups } from "../../src/builders/proxy-groups";
import { buildBaseLists } from "../../src/builders/selectors";
import { PROXY_GROUPS } from "../../src/catalog/group-names";
import type { ScriptArgs } from "../../src/types/args";
import type { ClashConfig } from "../../src/types/clash";
import type { ProxyGroup } from "../../src/types/proxy";

function run(args: ScriptArgs, config: ClashConfig): ClashConfig {
    const flags = buildFeatureFlags(args);
    const proxies = config.proxies ?? [];
    const nodes = analyzeNodes(proxies, flags.countryThreshold);
    const lists = buildBaseLists({
        landing: nodes.landing,
        landingNodes: nodes.landingNodes,
        lowCostNodes: nodes.lowCostNodes,
        nonLandingNodes: nodes.nonLandingNodes,
        tailscaleNodes: nodes.tailscaleNodes,
        regexFilter: flags.regexFilter,
        regions: nodes.regionLayout,
    });
    const proxyGroups = buildProxyGroups({ flags, nodes, lists });
    return assembleConfig(config, { flags, nodes, proxyGroups });
}

function group(config: ClashConfig, name: string): ProxyGroup | undefined {
    return config["proxy-groups"]?.find((item) => item.name === name);
}

const LANDING_A = { name: "落地A", "dialer-proxy": PROXY_GROUPS.FRONT_PROXY };
const LANDING_B = { name: "落地B", "dialer-proxy": PROXY_GROUPS.FRONT_PROXY };

const GROUPED: ClashConfig = {
    proxies: [
        { name: "香港01" },
        { name: "香港02" },
        { name: "美国01" },
        { name: "美国02" },
        LANDING_A,
        LANDING_B,
    ],
};

describe("Tracker 分流", () => {
    it("代理组以 DIRECT 优先，其后列出落地节点", () => {
        const result = run({}, GROUPED);

        for (const name of [PROXY_GROUPS.TRACKER_PROXY, PROXY_GROUPS.TRACKER_DIRECT]) {
            assert.deepEqual(group(result, name)?.proxies, ["DIRECT", "落地A", "落地B"]);
        }
    });

    it("无落地节点时只保留 DIRECT", () => {
        const result = run({}, { proxies: [{ name: "香港01" }, { name: "香港02" }] });
        assert.deepEqual(group(result, PROXY_GROUPS.TRACKER_PROXY)?.proxies, ["DIRECT"]);
    });

    it("代理组排在落地节点之后、静态资源之前", () => {
        const names = run({}, GROUPED)["proxy-groups"]?.map((item) => item.name) ?? [];
        const start = names.indexOf(PROXY_GROUPS.LANDING);

        assert.deepEqual(names.slice(start, start + 4), [
            PROXY_GROUPS.LANDING,
            PROXY_GROUPS.TRACKER_PROXY,
            PROXY_GROUPS.TRACKER_DIRECT,
            PROXY_GROUPS.STATIC_RESOURCES,
        ]);
    });

    it("规则位于广告拦截之前", () => {
        const rules = run({}, GROUPED).rules ?? [];
        const proxyIndex = rules.indexOf(`RULE-SET,TrackerProxy,${PROXY_GROUPS.TRACKER_PROXY}`);
        const directIndex = rules.indexOf(`RULE-SET,TrackerDirect,${PROXY_GROUPS.TRACKER_DIRECT}`);

        assert.ok(proxyIndex >= 0 && directIndex === proxyIndex + 1);
        assert.ok(directIndex < rules.indexOf(`RULE-SET,ADBlock,${PROXY_GROUPS.AD_BLOCK}`));
    });
});
