using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 稀有度 5 档（D10，武器与秘卷共用）：普通 / 精良 / 稀有 / 史诗 / 传说。
    /// 名字与颜色同 Three.js 版 src/core/types.ts 的 RARITY_NAMES / RARITY_COLORS（#cfd3da #62d36a #4aa3ff #b45cff #ffa726）。
    /// 各系统自己的权重 / 倍率（武器伤害倍率、秘卷出卡权重）留在各自的表里。
    /// </summary>
    public static class Rarity
    {
        public const int Common = 0, Uncommon = 1, Rare = 2, Epic = 3, Legendary = 4;
        public const int Count = 5;

        public static readonly string[] Names = { "普通", "精良", "稀有", "史诗", "传说" };
        public static readonly Color[] Colors = { Hex.Rgb(0xcfd3da), Hex.Rgb(0x62d36a), Hex.Rgb(0x4aa3ff), Hex.Rgb(0xb45cff), Hex.Rgb(0xffa726) };

        public static int Clamp(int rarity) => Mathf.Clamp(rarity, 0, Count - 1);
        public static string Name(int rarity) => Names[Clamp(rarity)];
        public static Color Color(int rarity) => Colors[Clamp(rarity)];
        /// <summary>富文本用的 RRGGBB（不带 #）</summary>
        public static string HexString(int rarity) => ColorUtility.ToHtmlStringRGB(Colors[Clamp(rarity)]);
    }
}
