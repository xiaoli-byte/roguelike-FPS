using System;
using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 一条词条的快照（<see cref="WeaponSave.affixes"/>，跨关 / 存档；JsonUtility 可序列化）。顺序原样保存：固有 → 抽到的 → 传说特性。
    /// 读回时整体替换实例的词条（含固有词条）；旧快照没有这一项（null 或空）时保留实例构造时带的固有词条。
    /// </summary>
    [Serializable]
    public struct AffixSave
    {
        public string id;
        public float value;

        public AffixSave(string id, float value)
        {
            this.id = id;
            this.value = value;
        }

        /// <summary>实例的全部词条 → 快照（没有词条为空数组）</summary>
        public static AffixSave[] Capture(WeaponInstance w)
        {
            if (w == null || w.affixes.Count == 0) return Array.Empty<AffixSave>();
            var a = new AffixSave[w.affixes.Count];
            for (int i = 0; i < a.Length; i++) a[i] = new AffixSave(w.affixes[i].id, w.affixes[i].value);
            return a;
        }

        /// <summary>快照 → 实例词条（空 id 跳过；未知 id 原样保留，数值解析器忽略它）</summary>
        public static void Restore(WeaponInstance w, AffixSave[] saved)
        {
            if (w == null || saved == null || saved.Length == 0) return;
            var list = new List<WeaponAffix>(saved.Length);
            foreach (var s in saved)
                if (!string.IsNullOrEmpty(s.id)) list.Add(new WeaponAffix(s.id, s.value));
            w.SetAffixes(list);
        }
    }
}
