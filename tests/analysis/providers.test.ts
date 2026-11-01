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
import type { ProxyGroup, ProxyNode } from "../../src/types/proxy";

function run(args: ScriptArgs, proxies: ProxyNode[]): ClashConfig {
    const flags = buildFeatureFlags(args);
    const nodes = analyzeNodes(proxies, flags.countryThreshold, flags.splitProviders);
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
    return assembleConfig({ proxies }, { flags, nodes, proxyGroups });
}

function group(config: ClashConfig, name: string): ProxyGroup | undefined {
    return config["proxy-groups"]?.find((item) => item.name === name);
}

function toNodes(...names: string[]): ProxyNode[] {
    return names.map((name) => ({ name }));
}

const NODES = toNodes(
    "🇭🇰 aaaCloud - HK 01",
    "🇭🇰 aaaCloud - HK 02",
    "🇭🇰 bbbCloud - HK 01",
    "🇭🇰 other - HK 01",
    "🇹🇼 ccc - TW 01",
    "🇹🇼 ccc - TW 02",
    "🇺🇸 aaaCloud - US 01",
    "🇺🇸 aaaCloud - US 02"
);

const ONE_REGION = toNodes("🇭🇰 aaaCloud - HK 01", "🇭🇰 aaaCloud - HK 02", "🇭🇰 bbbCloud - HK 01");

describe("splitproviders 参数解析", () => {
    it("去除空白、空项与重复项", () => {
        const flags = buildFeatureFlags({ splitproviders: " aaa, bbb,,aaa " });
        assert.deepEqual(flags.splitProviders, ["aaa", "bbb"]);
    });

    it("未传参时为空列表", () => {
        assert.deepEqual(buildFeatureFlags({}).splitProviders, []);
    });

    it("Substore 把空值解析为 true 时不当作列表项", () => {
        const flags = buildFeatureFlags({ splitproviders: true as unknown as string });
        assert.deepEqual(flags.splitProviders, []);
    });
});

describe("splitproviders 分组", () => {
    it("未配置时不写入 providerSplits", () => {
        const { regionLayout } = analyzeNodes(NODES, 2);
        assert.ok(!("providerSplits" in regionLayout));
    });

    it("基础分组只保留未被匹配的节点，子分组枚举对应节点", () => {
        const result = run({ splitproviders: "aaaCloud,bbbCloud" }, NODES);

        assert.deepEqual(group(result, "香港节点（aaaCloud）")?.proxies, [
            "🇭🇰 aaaCloud - HK 01",
            "🇭🇰 aaaCloud - HK 02",
        ]);
        assert.deepEqual(group(result, "香港节点（bbbCloud）")?.proxies, ["🇭🇰 bbbCloud - HK 01"]);
        assert.deepEqual(group(result, "香港节点")?.proxies, ["🇭🇰 other - HK 01"]);
    });

    it("子分组类型与地区组一致", () => {
        const result = run({ splitproviders: "aaaCloud", grouptype: "0" }, NODES);
        assert.equal(group(result, "香港节点（aaaCloud）")?.type, "select");
    });

    it("候选列表中子分组在前、基础分组在后", () => {
        const result = run({ splitproviders: "aaaCloud,bbbCloud" }, NODES);

        assert.deepEqual(group(result, PROXY_GROUPS.FALLBACK)?.proxies, [
            "香港节点（aaaCloud）",
            "香港节点（bbbCloud）",
            "香港节点",
            "台湾节点",
            "美国节点（aaaCloud）",
        ]);
    });

    it("使用词边界匹配，不把相似名称归入提供商", () => {
        const result = run(
            { splitproviders: "aaaCloud" },
            toNodes(
                "🇭🇰 aaaCloud - HK 01",
                "🇭🇰 aaaCloudPlus - HK 01",
                "🇹🇼 ccc - TW 01",
                "🇹🇼 ccc - TW 02"
            )
        );

        assert.deepEqual(group(result, "香港节点（aaaCloud）")?.proxies, ["🇭🇰 aaaCloud - HK 01"]);
        assert.deepEqual(group(result, "香港节点")?.proxies, ["🇭🇰 aaaCloudPlus - HK 01"]);
    });

    it("按大小写不敏感去重，保留首次出现的拼写", () => {
        const result = run({ splitproviders: "aaaCloud,AAACLOUD" }, NODES);
        const names = result["proxy-groups"]?.map((item) => item.name) ?? [];

        assert.ok(names.includes("香港节点（aaaCloud）"));
        assert.ok(!names.includes("香港节点（AAACLOUD）"));
    });

    it("一个节点可同时归属多个提供商", () => {
        const result = run(
            { splitproviders: "aaa,bbb" },
            toNodes("🇭🇰 aaa - bbb 01", "🇭🇰 aaa - bbb 02", "🇹🇼 ccc - TW 01", "🇹🇼 ccc - TW 02")
        );

        assert.deepEqual(
            group(result, "香港节点（aaa）")?.proxies,
            group(result, "香港节点（bbb）")?.proxies
        );
    });

    it("地区节点全部属于提供商时省略基础分组，且无悬空引用", () => {
        const result = run({ splitproviders: "aaaCloud" }, NODES);
        const usNodes = group(result, "美国节点");
        const truthSocial = group(result, PROXY_GROUPS.TRUTH_SOCIAL);

        assert.equal(usNodes, undefined);
        assert.deepEqual(truthSocial?.proxies, [
            "美国节点（aaaCloud）",
            PROXY_GROUPS.SELECT,
            PROXY_GROUPS.MANUAL,
        ]);

        const groupNames = new Set(result["proxy-groups"]?.map((item) => item.name));
        const references = group(result, PROXY_GROUPS.SELECT)?.proxies ?? [];
        assert.ok(references.every((name) => name === "DIRECT" || groupNames.has(name)));
    });

    it("服务组引用地区时列出全部子分组", () => {
        const result = run({ splitproviders: "aaaCloud,ccc" }, NODES);

        assert.deepEqual(group(result, PROXY_GROUPS.BILIBILI)?.proxies, [
            "DIRECT",
            "台湾节点（ccc）",
            "香港节点（aaaCloud）",
            "香港节点",
        ]);
    });

    it("threshold 只按地区总量判定，单节点子分组同样生成", () => {
        const result = run({ splitproviders: "bbbCloud" }, NODES);
        assert.deepEqual(group(result, "香港节点（bbbCloud）")?.proxies, ["🇭🇰 bbbCloud - HK 01"]);
    });

    it("提供商与地区节点都未匹配时输出与关闭时一致", () => {
        assert.deepEqual(run({ splitproviders: "none" }, NODES), run({}, NODES));
    });
});

describe("splitproviders 正则模式", () => {
    it("基础分组排除提供商，子分组仍枚举节点", () => {
        const result = run({ splitproviders: "aaaCloud,bbbCloud", regex: "true" }, NODES);
        const base = group(result, "香港节点");

        assert.equal(
            base?.["exclude-filter"],
            String.raw`(?i:(?:^|[\s\-])aaaCloud(?:[\s\-]|$)|(?:^|[\s\-])bbbCloud(?:[\s\-]|$))`
        );
        assert.equal(base?.["include-all"], true);
        assert.deepEqual(group(result, "香港节点（bbbCloud）")?.proxies, ["🇭🇰 bbbCloud - HK 01"]);
        assert.equal(group(result, "香港节点（bbbCloud）")?.["include-all"], undefined);
    });

    it("与地区 excludePattern 合并", () => {
        const proxies = toNodes(
            "🇺🇸 other - US 01",
            "🇺🇸 other - US 02",
            "🇭🇰 aaaCloud - HK 01",
            "🇭🇰 aaaCloud - HK 02"
        );
        const result = run({ splitproviders: "aaaCloud", regex: "true" }, proxies);

        assert.equal(
            group(result, "美国节点")?.["exclude-filter"],
            String.raw`美属|亚美尼亚|圣多美|普林西比|(?i:(?:^|[\s\-])aaaCloud(?:[\s\-]|$))`
        );
    });

    it("提供商名称中的正则元字符按字面量处理", () => {
        const result = run({ splitproviders: "a.b", regex: "true" }, NODES);
        assert.match(group(result, "香港节点")?.["exclude-filter"] ?? "", /a\\\.b/);
    });
});

describe("splitproviders 与展平模式", () => {
    it("未配置时单地区展平", () => {
        assert.equal(analyzeNodes(ONE_REGION, 2).regionLayout.mode, "flattened");
    });

    it("单地区拆出至少 2 个分组时保持分组模式", () => {
        const result = run({ splitproviders: "aaaCloud,bbbCloud" }, ONE_REGION);

        assert.ok(group(result, "香港节点（aaaCloud）"));
        assert.ok(group(result, "香港节点（bbbCloud）"));
        assert.ok(group(result, PROXY_GROUPS.MANUAL));
    });

    it("单地区只拆出 1 个分组时仍然展平", () => {
        const proxies = toNodes("🇭🇰 aaaCloud - HK 01", "🇭🇰 aaaCloud - HK 02");
        const flags = analyzeNodes(proxies, 2, ["aaaCloud"]);

        assert.equal(flags.regionLayout.mode, "flattened");
        assert.ok(!("providerSplits" in flags.regionLayout));
    });

    it("没有达标地区时展平", () => {
        const proxies = toNodes("🇭🇰 aaaCloud - HK 01", "🇹🇼 aaaCloud - TW 01");
        assert.equal(analyzeNodes(proxies, 2, ["aaaCloud"]).regionLayout.mode, "flattened");
    });
});
