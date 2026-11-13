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

    it("代理组排在落地节点与个人服务之后、静态资源之前", () => {
        const names = run({}, GROUPED)["proxy-groups"]?.map((item) => item.name) ?? [];
        const start = names.indexOf(PROXY_GROUPS.LANDING);

        assert.deepEqual(names.slice(start, start + 5), [
            PROXY_GROUPS.LANDING,
            PROXY_GROUPS.PERSONAL_SERVICES,
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

describe("个人服务分流", () => {
    it("代理组以 DIRECT 优先", () => {
        const proxies = group(run({}, GROUPED), PROXY_GROUPS.PERSONAL_SERVICES)?.proxies;
        assert.equal(proxies?.[0], "DIRECT");
    });

    it("规则位于 Tracker 规则之前", () => {
        const rules = run({}, GROUPED).rules ?? [];
        const personalIndex = rules.indexOf(
            `RULE-SET,PersonalServices,${PROXY_GROUPS.PERSONAL_SERVICES}`
        );

        assert.ok(personalIndex >= 0);
        assert.ok(
            personalIndex < rules.indexOf(`RULE-SET,TrackerProxy,${PROXY_GROUPS.TRACKER_PROXY}`)
        );
    });
});

describe("inlinelanding", () => {
    it("默认保留对落地节点组的引用", () => {
        const result = run({}, GROUPED);
        assert.ok(group(result, PROXY_GROUPS.SELECT)?.proxies?.includes(PROXY_GROUPS.LANDING));
    });

    it("在原位置展开为落地节点名称，并保持其顺序", () => {
        const result = run({ inlinelanding: "true" }, GROUPED);

        assert.deepEqual(group(result, PROXY_GROUPS.FALLBACK)?.proxies, [
            "落地A",
            "落地B",
            "香港节点",
            "美国节点",
        ]);
    });

    it("除落地节点组自身与 GLOBAL 外不再有组引用落地节点组", () => {
        const result = run({ inlinelanding: "true" }, GROUPED);
        const referrers = result["proxy-groups"]
            ?.filter((item) => item.proxies?.includes(PROXY_GROUPS.LANDING))
            .map((item) => item.name);

        assert.deepEqual(referrers, [PROXY_GROUPS.GLOBAL]);
    });

    it("GLOBAL 保留完整的代理组排序表", () => {
        const result = run({ inlinelanding: "true" }, GROUPED);
        const groups = result["proxy-groups"] ?? [];

        assert.deepEqual(
            group(result, PROXY_GROUPS.GLOBAL)?.proxies,
            groups.slice(0, -1).map((item) => item.name)
        );
    });

    it("展平模式下同样展开", () => {
        const result = run(
            { inlinelanding: "true" },
            { proxies: [{ name: "香港01" }, { name: "香港02" }, LANDING_A] }
        );

        assert.deepEqual(group(result, PROXY_GROUPS.FALLBACK)?.proxies, [
            "落地A",
            "香港01",
            "香港02",
        ]);
    });

    it("无落地节点时输出不变", () => {
        const config = { proxies: [{ name: "香港01" }, { name: "美国01" }] };
        assert.deepEqual(run({ inlinelanding: "true" }, config), run({}, config));
    });
});

describe("globalgroup", () => {
    it("默认定义 GLOBAL 组", () => {
        assert.ok(group(run({}, GROUPED), PROXY_GROUPS.GLOBAL));
    });

    it("传 false 时不定义 GLOBAL 组，其余代理组不变", () => {
        const withGlobal = run({}, GROUPED)["proxy-groups"] ?? [];
        const withoutGlobal = run({ globalgroup: "false" }, GROUPED)["proxy-groups"] ?? [];

        assert.deepEqual(withoutGlobal, withGlobal.slice(0, -1));
    });

    it("可与 inlinelanding 同时使用", () => {
        const result = run({ globalgroup: "false", inlinelanding: "true" }, GROUPED);

        assert.equal(group(result, PROXY_GROUPS.GLOBAL), undefined);
        assert.ok(group(result, PROXY_GROUPS.SELECT)?.proxies?.includes("落地A"));
    });
});
