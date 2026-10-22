using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Spiritfire.Game
{
    /// <summary>
    /// 看过哪些首领的登场演出（存档的「cinematics」段，跟着当前档 <see cref="SaveService.Profile"/>）：
    /// 第一次看至少 <see cref="BossIntroDirector.FirstViewLock"/> 秒才能跳过；看过（播完或跳过）之后，下一次一开始就能按住交互键跳过。
    /// </summary>
    public sealed class BossIntroLog : ISaveSection, ISaveFileBound
    {
        public const string SectionKey = "cinematics";

        readonly HashSet<string> seen = new(StringComparer.Ordinal);

        public string Key => SectionKey;
        public int Version => 1;
        public SaveFile File { get; private set; }

        void ISaveFileBound.Bind(SaveFile file) => File = file;

        /// <summary>当前档的记录</summary>
        public static BossIntroLog Current => SaveService.Profile.Section<BossIntroLog>();

        public IReadOnlyCollection<string> SeenIds => seen;

        public bool Seen(string bossId) => !string.IsNullOrEmpty(bossId) && seen.Contains(bossId);

        /// <summary>记一笔「看过」（新记的稍后写盘）</summary>
        public void MarkSeen(string bossId)
        {
            if (string.IsNullOrEmpty(bossId) || !seen.Add(bossId)) return;
            File?.SaveSoon();
        }

        /// <summary>忘掉一只（调试命令、冒烟测试验证首看锁）；返回之前是不是看过</summary>
        public bool Forget(string bossId)
        {
            if (string.IsNullOrEmpty(bossId) || !seen.Remove(bossId)) return false;
            File?.SaveSoon();
            return true;
        }

        public void ForgetAll()
        {
            if (seen.Count == 0) return;
            seen.Clear();
            File?.SaveSoon();
        }

        public string Capture() => new JObject { ["seen"] = new JArray(seen.OrderBy(s => s, StringComparer.Ordinal)) }.ToString(Formatting.None);

        /// <summary>宽容读取：坏字段忽略</summary>
        public void Restore(string json, int version)
        {
            seen.Clear();
            if (string.IsNullOrEmpty(json)) return;
            JObject o;
            try
            {
                o = JObject.Parse(json);
            }
            catch (JsonException)
            {
                return;
            }
            if (o["seen"] is not JArray arr) return;
            foreach (var t in arr)
                if (t.Type == JTokenType.String && !string.IsNullOrEmpty((string)t))
                    seen.Add((string)t);
        }
    }
}
