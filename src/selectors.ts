import { NODE_SUFFIX, PROXY_GROUPS } from "./constants";
import { partitionNodesByProvider } from "./node_parser";
import { buildList } from "./utils";
import type {
    BaseLists,
    BuildBaseListsInput,
    BuildCountryGroupPlansInput,
    CountryGroupPlan,
} from "./types";

/**
 * 根据当前功能开关和节点信息，构建各代理组所需的基础代理列表。
 * @param input - 构建基础列表所需的输入参数
 * @param input.landing - 是否存在落地节点
 * @param input.lowCostNodes - 低价节点名称列表
 * @param input.countryGroupNames - 已构建完成的地区分组名数组（含提供商子分组，按显示顺序排列）
 * @param input.nonLandingNodes - 非落地节点名称列表（仅在非正则过滤模式下使用）
 * @param input.regexFilter - 是否使用正则过滤模式
 * @returns 包含各场景下代理列表的 `BaseLists` 对象
 */
export function buildBaseLists({
    landing,
    lowCostNodes,
    countryGroupNames,
    nonLandingNodes,
    regexFilter,
}: BuildBaseListsInput): BaseLists {
    const lowCost = lowCostNodes.length > 0 || regexFilter;

    const defaultSelector = buildList(
        PROXY_GROUPS.AUTO,
        PROXY_GROUPS.FALLBACK,
        landing && PROXY_GROUPS.LANDING,
        countryGroupNames,
        lowCost && PROXY_GROUPS.LOW_COST,
        PROXY_GROUPS.MANUAL,
        "DIRECT"
    );

    const defaultProxies = buildList(
        PROXY_GROUPS.SELECT,
        landing && PROXY_GROUPS.LANDING,
        countryGroupNames,
        lowCost && PROXY_GROUPS.LOW_COST,
        PROXY_GROUPS.MANUAL,
        "DIRECT"
    );

    const defaultProxiesDirect = buildList(
        "DIRECT",
        landing && PROXY_GROUPS.LANDING,
        countryGroupNames,
        lowCost && PROXY_GROUPS.LOW_COST,
        PROXY_GROUPS.SELECT,
        PROXY_GROUPS.MANUAL
    );

    const defaultFallback = buildList(landing && PROXY_GROUPS.LANDING, countryGroupNames);

    const frontProxySelector = buildList(
        countryGroupNames,
        "DIRECT",
        !regexFilter && nonLandingNodes.map((node) => node.name).filter(Boolean)
    );

    return {
        defaultProxies,
        defaultProxiesDirect,
        defaultSelector,
        defaultFallback,
        frontProxySelector,
    };
}

/**
 * 构建各地区及其提供商的子分组计划。
 * @description 地区分组名、成员划分与「基础分组是否为空」的判定都收口在此，
 * 供 `buildBaseLists` 与 `buildProxyGroups` 共同消费，避免两处各自推导而产生分歧。
 * @param input - 构建计划所需的输入参数
 * @param input.countryNames - 已激活的纯地区名数组（不含后缀）
 * @param input.countryNodes - 地区名到节点数组的映射
 * @param input.splitProviders - 需要单独成组的提供商名称列表
 * @returns 按 `countryNames` 顺序排列的分组计划数组
 */
export function buildCountryGroupPlans({
    countryNames,
    countryNodes,
    splitProviders,
}: BuildCountryGroupPlansInput): CountryGroupPlan[] {
    return countryNames.map((country) => {
        const { groups, rest } = partitionNodesByProvider(
            countryNodes[country] ?? [],
            splitProviders
        );

        return {
            country,
            baseName: `${country}${NODE_SUFFIX}`,
            baseNodes: rest,
            subGroups: groups.map((group) => ({
                provider: group.provider,
                name: `${country}${NODE_SUFFIX}（${group.provider}）`,
                nodes: group.nodes,
            })),
        };
    });
}

/**
 * 取出一个地区计划对应的全部代理组名，顺序为「各提供商子分组在前、基础分组在后」。
 * @description 基础分组的节点为空时自动省略该名称——这是「基础分组为空则不生成」的唯一判定点。
 * @param plan - 单个地区的分组计划
 * @returns 该地区的代理组名数组
 */
export function getCountryGroupNames(plan: CountryGroupPlan): string[] {
    return buildList(
        plan.subGroups.map((subGroup) => subGroup.name),
        plan.baseNodes.length > 0 && plan.baseName
    );
}
