using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using UnityEngine;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 整局冒烟分段跑时的接力档（I2；一次试玩超过 600 s 时拆成 full-run-ch1 / ch2 / ch3）：上一段在下一章第一关就绪时写下
    /// 进关快照（<see cref="SceneFlow.EntrySnapshot"/>：英雄、种子、武器、秘卷、灵石、灵宠、生命护盾、标记…）和已经打完的各关成绩；
    /// 下一段读回来，把它设成当前局、从那一关接着打。三段按顺序跑完 = 整局。
    /// 文件在 unity/Library/SpiritfireBridge/fullrun_relay.json（不入库）。RunState 按字段序列化（属性不写），字典照常写。
    /// </summary>
    [Serializable]
    public sealed class RunRelay
    {
        public const int Version = 1;

        public int version = Version;
        /// <summary>写下这一档的分段（full-run-ch1 …）和时间（UTC）</summary>
        public string writtenBy, writtenAt;
        /// <summary>下一段从哪一关接着打（= run.stageCode）</summary>
        public string nextStage;
        public RunState run;
        public List<StageRecord> records = new();
        /// <summary>前面各段的真实耗时（秒）</summary>
        public List<float> segmentSeconds = new();
        public int downs;

        public static string FilePath => Path.Combine(Directory.GetCurrentDirectory(), "Library", "SpiritfireBridge", "fullrun_relay.json");

        sealed class FieldsOnly : DefaultContractResolver
        {
            protected override List<MemberInfo> GetSerializableMembers(Type objectType) =>
                objectType.GetFields(BindingFlags.Instance | BindingFlags.Public).Where(f => !f.IsNotSerialized).Cast<MemberInfo>().ToList();

            protected override JsonProperty CreateProperty(MemberInfo member, MemberSerialization memberSerialization)
            {
                var p = base.CreateProperty(member, memberSerialization);
                p.Readable = p.Writable = true;
                return p;
            }
        }

        static JsonSerializerSettings Settings => new()
        {
            ContractResolver = new FieldsOnly(),
            Formatting = Formatting.Indented,
            ReferenceLoopHandling = ReferenceLoopHandling.Ignore,
            FloatFormatHandling = FloatFormatHandling.DefaultValue,
        };

        public void Save()
        {
            writtenAt = DateTime.UtcNow.ToString("u");
            Directory.CreateDirectory(Path.GetDirectoryName(FilePath));
            File.WriteAllText(FilePath, JsonConvert.SerializeObject(this, Settings));
        }

        /// <summary>读接力档；没有 / 坏了返回 null（error 里写原因）</summary>
        public static RunRelay Load(out string error)
        {
            error = null;
            if (!File.Exists(FilePath))
            {
                error = "没有接力档（先跑上一段）";
                return null;
            }
            try
            {
                var r = JsonConvert.DeserializeObject<RunRelay>(File.ReadAllText(FilePath), Settings);
                if (r == null || r.run == null) error = "接力档是空的";
                else if (r.version != Version) error = $"接力档版本 {r.version}（应为 {Version}）";
                else return r;
            }
            catch (Exception e)
            {
                error = $"接力档读不了：{e.Message}";
            }
            return null;
        }

        public static void Delete()
        {
            try { if (File.Exists(FilePath)) File.Delete(FilePath); }
            catch (IOException) { }
        }

        /// <summary>RunState 深拷贝（同 SceneFlow.CloneRun）</summary>
        public static RunState Clone(RunState s) => SceneFlow.CloneRun(s);
    }
}
