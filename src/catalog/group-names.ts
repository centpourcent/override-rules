/**
 * 代理组的展示名称与命名辅助函数。
 */

import type { RegionLayout } from "../types/proxy";

/** 地区代理组名称的统一后缀，例如「香港」→「香港节点」。 */
const NODE_SUFFIX = "节点";

/** 所有策略组的显示名称。 */
export const PROXY_GROUPS = {
    SELECT: "选择代理",
    MANUAL: "手动选择",
    AUTO: "自动选择",
    FALLBACK: "故障转移",
    LANDING: "落地节点",
    LOW_COST: "低倍率节点",
    FRONT_PROXY: "前置代理",
    TRACKER_PROXY: "代理站点",
    TRACKER_DIRECT: "直连站点",
    STATIC_RESOURCES: "静态资源",
    AI_SERVICE: "AI服务",
    CRYPTO: "加密货币",
    FINANCE: "金融服务",
    APPLE: "苹果服务",
    GOOGLE: "谷歌服务",
    MICROSOFT: "微软服务",
    BILIBILI: "哔哩哔哩",
    BAHAMUT: "巴哈姆特",
    XBOX: "Xbox",
    TAILSCALE: "Tailscale",
    GITHUB: "Github",
    YOUTUBE: "Youtube",
    NETFLIX: "Netflix",
    TIKTOK: "TikTok",
    SPOTIFY: "Spotify",
    EHENTAI: "E-Hentai",
    TELEGRAM: "Telegram",
    TRUTH_SOCIAL: "Truth Social",
    TWITTER: "Twitter",
    TWITCH: "Twitch",
    WEIBO: "新浪微博",
    PIKPAK: "PikPak网盘",
    SOGOU_INPUT: "搜狗输入法",
    AD_BLOCK: "广告拦截",
    GLOBAL: "GLOBAL",
    FINAL: "Final",
} as const;

/**
 * 将纯地区名转换为带后缀的代理组名称。
 * @param country - 纯地区名（不含后缀），例如「香港」
 */
export function countryGroupName(country: string): string {
    return `${country}${NODE_SUFFIX}`;
}

/**
 * 取某地区实际生成的全部代理组名：各提供商子分组在前、基础分组在后，基础分组为空时省略。
 * @param regions - 地区代理组布局
 * @param country - 纯地区名（不含后缀）
 */
export function regionGroupNames(regions: RegionLayout, country: string): string[] {
    const split = regions.providerSplits?.[country];
    if (!split) return [countryGroupName(country)];

    const subGroupNames = split.subGroups.map((subGroup) => subGroup.name);
    return split.baseNodes.length > 0
        ? [...subGroupNames, countryGroupName(country)]
        : subGroupNames;
}
