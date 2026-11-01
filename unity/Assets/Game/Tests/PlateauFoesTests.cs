using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 第四章雷魅（E 路；设计单 docs/art/vfx/foes-ch4.md）的纯逻辑契约：
    ///   · 招式表 = docs/art/ch4-move-events.json（秒数逐项相等，时间点按招式总长归一化后与 clips 一致，误差 ≤ 0.002）；
    ///   · 七个资产的 Anim/&lt;资产&gt;.events.json 里每个招式都有、出手时刻与表一致（手 K 片段的事件也照表）；
    ///   · 招式时间轴：时间兜底逐帧出手、动画事件先到就先出且只认 ±0.15 s 内的、提前收招平移后面的时间点、AnimDelta 记录误差；
    ///   · 几何小工具；连鼓灵骨槌曲线（释放帧砸在 0.25 s、角度最大）；九个定义（id、AI、穷奇精英折算）。
    /// </summary>
    public sealed class PlateauFoesTests
    {
        static string Repo => Path.GetFullPath(Path.Combine(Application.dataPath, "..", ".."));

        static Dictionary<string, object> MoveTable()
        {
            var path = Path.Combine(Repo, "docs", "art", "ch4-move-events.json");
            Assert.IsTrue(File.Exists(path), path);
            return (Dictionary<string, object>)MiniJson.Parse(File.ReadAllText(path, Encoding.UTF8));
        }

        static Dictionary<string, object> Obj(object o, string key) => (Dictionary<string, object>)((Dictionary<string, object>)o)[key];
        static float F(object o) => Convert.ToSingle(o, CultureInfo.InvariantCulture);

        [Test]
        public void MovesMatchExportedTable()
        {
            var assets = Obj(MoveTable(), "assets");
            foreach (var (asset, moves) in PlateauMoves.ByAsset)
            {
                Assert.IsTrue(assets.ContainsKey(asset), $"ch4-move-events.json 里没有 {asset}");
                var table = Obj(Obj(assets, asset), "moves");
                var clips = Obj(Obj(assets, asset), "clips");
                Assert.AreEqual(table.Count, moves.Length, $"{asset} 招式数：表 {string.Join(",", table.Keys)}");
                foreach (var m in moves)
                {
                    Assert.IsTrue(table.ContainsKey(m.id), $"{asset} 表里没有 {m.id}");
                    var t = (Dictionary<string, object>)table[m.id];
                    Assert.AreEqual(F(t["windup"]), m.windup, 1e-4f, $"{asset}.{m.id} windup");
                    Assert.AreEqual(F(t["active"]), m.active, 1e-4f, $"{asset}.{m.id} active");
                    Assert.AreEqual(F(t["recover"]), m.recover, 1e-4f, $"{asset}.{m.id} recover");
                    var want = ((List<object>)clips[m.id]).Cast<Dictionary<string, object>>().Select(e => (F(e["at"]), (string)e["name"])).ToList();
                    var got = m.Timeline().Select(e => (e.at / Mathf.Max(1e-3f, m.Total), e.name)).ToList();
                    Assert.AreEqual(want.Count, got.Count, $"{asset}.{m.id} 时间点数");
                    for (int i = 0; i < want.Count; i++)
                    {
                        Assert.AreEqual(want[i].Item2, got[i].name, $"{asset}.{m.id} 第 {i} 个时间点");
                        Assert.AreEqual(want[i].Item1, got[i].Item1, 0.002f, $"{asset}.{m.id}.{want[i].Item2}");
                    }
                }
            }
        }

        static readonly string[] Animated = { "SK_Enemy_Marmot", "SK_Enemy_Tiangou", "SK_Enemy_Aoyin", "SK_Enemy_Jufu", "SK_Enemy_Manman", "SK_Enemy_Dijiang", "SK_Enemy_Qiongqi" };

        [Test]
        public void EventsJsonMatchesTable()
        {
            var assets = Obj(MoveTable(), "assets");
            foreach (var asset in Animated)
            {
                var path = Path.Combine(Repo, "unity", "Assets", "Art", "Characters", asset, "Anim", asset + ".events.json");
                Assert.IsTrue(File.Exists(path), path);
                var clips = Obj(MiniJson.Parse(File.ReadAllText(path, Encoding.UTF8)), "clips");
                var table = Obj(Obj(assets, asset), "clips");
                foreach (var (id, evs) in table)
                {
                    Assert.IsTrue(clips.ContainsKey(id), $"{asset}.events.json 没有 {id}");
                    var want = ((List<object>)evs).Cast<Dictionary<string, object>>().ToList();
                    var got = ((List<object>)clips[id]).Cast<Dictionary<string, object>>().ToList();
                    foreach (var w in want)
                    {
                        var name = (string)w["name"];
                        var g = got.FirstOrDefault(x => (string)x["name"] == name);
                        Assert.IsNotNull(g, $"{asset}.{id} 缺事件 {name}");
                        Assert.AreEqual(F(w["at"]), F(g["at"]), 0.002f, $"{asset}.{id}.{name}");
                    }
                }
            }
        }

        static PlateauMove Test(float w = 0.5f, float a = 1f, float r = 0.5f) => new()
        {
            id = "t", windup = w, active = a, recover = r, glint = true, events = new[] { (w + a, "land") },
        };

        static List<(float t, string e)> Run(PlateauMoveRunner run, float seconds, Action<float> each = null)
        {
            var fired = new List<string>();
            var log = new List<(float, string)>();
            float t = 0;
            while (t < seconds && run.Busy)
            {
                each?.Invoke(t);
                run.Tick(1f / 60f, fired);
                t += 1f / 60f;
                foreach (var e in fired) log.Add((t, e));
            }
            return log;
        }

        [Test]
        public void RunnerFiresOnTimelineWithinOneFrame()
        {
            var m = Test();
            var run = new PlateauMoveRunner();
            run.Start(m);
            var fired = new List<string>();
            run.Tick(0, fired);
            CollectionAssert.AreEqual(new[] { "warn" }, fired, "warn 在开招那一帧");
            var log = Run(run, 5f);
            foreach (var (at, name) in m.Timeline().Where(e => e.name != "warn"))
            {
                var hit = log.FirstOrDefault(l => l.e == name);
                Assert.IsNotNull(hit.e, $"没出 {name}");
                Assert.LessOrEqual(Mathf.Abs(hit.t - at), 1f / 60f + 1e-4f, $"{name} 出手 {hit.t:0.000} s，时间轴 {at:0.000} s");
            }
            Assert.IsFalse(run.Busy, "收招结束后空闲");
        }

        [Test]
        public void AnimEventFiresEarlyAndIsMeasured()
        {
            var m = Test();
            var run = new PlateauMoveRunner();
            var measured = new List<(string move, string name, float delta, float frame)>();
            run.AnimMeasured += (mv, n, d, f) => measured.Add((mv, n, d, f));
            run.Start(m);
            var fired = new List<string>();
            run.Tick(0, fired);
            // 前摇 0.45 s 时片段先发 hit（时间轴 0.5 s）：这一帧就出，记下 −0.05 s
            Run(run, 0.45f);
            run.OnAnimEvent("hit");
            run.Tick(0, fired);
            CollectionAssert.Contains(fired, "hit");
            Assert.IsTrue(run.CueDelta["hit"].anim, "hit 是动画事件先到");
            Assert.AreEqual(-0.05f, run.AnimDelta["hit"], 0.02f);
            Assert.AreEqual(1, measured.Count, "每个动画事件报一次");
            Assert.AreEqual(m.id, measured[0].move);
            Assert.AreEqual("hit", measured[0].name);
            Assert.AreEqual(-0.05f, measured[0].delta, 0.02f);
            Assert.GreaterOrEqual(measured[0].frame, 0f);
            // 下一招开始清空上一招的实测（试玩套件按招归账）
            run.Start(m);
            Assert.AreEqual(0, run.AnimDelta.Count, "新的一招从空表开始");
            // 离时间轴 0.15 s 以外的同名事件（交叉淡出的上一招）不认
            var run2 = new PlateauMoveRunner();
            run2.Start(m);
            run2.OnAnimEvent("hit");
            run2.Tick(0, fired);
            CollectionAssert.DoesNotContain(fired, "hit");
        }

        [Test]
        public void FinishActiveShiftsLaterEvents()
        {
            var m = Test(0.5f, 1.6f, 0.8f);
            var run = new PlateauMoveRunner();
            run.Start(m);
            var log = Run(run, 0.9f);
            Assert.AreEqual(MoveStage.Active, run.Stage);
            run.FinishActive();
            Assert.AreEqual(MoveStage.Recover, run.Stage, "提前收招：直接进收招段");
            Assert.AreEqual(m.windup + m.active, run.RecoverClipTime, 1e-4f, "片段的收招段起点");
            log = Run(run, 3f);
            var land = log.FirstOrDefault(l => l.e == "land");
            Assert.IsNotNull(land.e, "land 平移到提前收招那一刻");
            Assert.LessOrEqual(land.t, 0.05f);
            var end = log.FirstOrDefault(l => l.e == "end");
            Assert.AreEqual(0.8f, end.t, 0.05f, "end 平移成「收招段结束」");
        }

        [Test]
        public void GeometryHelpers()
        {
            Assert.AreEqual(1f, PlateauGeo.SegDist(new Vector3(0, 5, 1), Vector3.zero, new Vector3(4, 0, 0)), 1e-4f);
            Assert.AreEqual(1f, PlateauGeo.SegDist(new Vector3(2, 0, 1), Vector3.zero, new Vector3(4, 0, 0)), 1e-4f);
            Assert.IsTrue(PlateauGeo.InCone(new Vector3(0, 0, 3), Vector3.zero, 0, 4, 0.5f));
            Assert.IsFalse(PlateauGeo.InCone(new Vector3(3, 0, 0), Vector3.zero, 0, 4, 0.5f));
            Assert.IsTrue(PlateauGeo.InCone(new Vector3(0.5f, 0, -0.5f), Vector3.zero, 0, 4, 0.1f), "1 m 内总算在");
            var k = PlateauGeo.Knock(new Vector3(0, 0, 2), Vector3.zero, 6, 3);
            Assert.AreEqual(6f, new Vector2(k.x, k.z).magnitude, 1e-3f);
            Assert.AreEqual(3f, k.y, 1e-4f);
        }

        [Test]
        public void LianguMalletStrikesOnTheBeat()
        {
            Assert.AreEqual(PlateauMoves.LianguBeat.Total, LianguKeys.Length, 1e-4f, "一拍 = 鼓点招式总长");
            Assert.AreEqual(PlateauMoves.LianguBeat.windup, LianguKeys.Strike, 1e-3f, "释放帧 = beat 事件");
            float peak = float.MinValue, at = 0;
            for (float t = 0; t <= LianguKeys.Length; t += 1f / 120f)
            {
                float v = LianguKeys.Swing.Evaluate(t);
                if (v > peak)
                {
                    peak = v;
                    at = t;
                }
            }
            Assert.AreEqual(LianguKeys.Strike, at, 1f / 60f, "骨槌在释放帧砸到最低");
            Assert.Less(LianguKeys.Swing.Evaluate(0.13f), LianguKeys.Swing.Evaluate(0f), "起手先往回抬（反向预备）");
            Assert.AreEqual(LianguKeys.Swing.Evaluate(0f), LianguKeys.Swing.Evaluate(LianguKeys.Length), 0.01f, "一拍首尾接得上");
        }

        [Test]
        public void PlateauDefsAreRegistered()
        {
            var ids = new Dictionary<string, Type>
            {
                ["marmot"] = typeof(MarmotAI), ["tiangou"] = typeof(TiangouAI), ["aoyin"] = typeof(AoyinAI), ["leiyak"] = typeof(AoyinAI), ["jufu"] = typeof(JufuAI),
                ["manman"] = typeof(ManmanAI), ["liangu"] = typeof(LianguAI), ["dijiang"] = typeof(DijiangAI), ["qiongqi"] = typeof(QiongqiAI),
            };
            foreach (var (id, ai) in ids)
            {
                var d = EnemyRoster.Get(id);
                Assert.IsNotNull(d, $"名册里没有 {id}");
                Assert.AreEqual(ai, d.ai, $"{id} 的 AI");
                Assert.Greater(d.poise, 0, $"{id} 的韧性（第四章受击四层）");
            }
            var q = EnemyRoster.Get("qiongqi");
            Assert.AreEqual(Rank.Elite, q.rank, "穷奇名册直接是精英");
            Assert.AreEqual(1100f, q.hp * 2.6f, 1.5f, "穷奇精英折算后生命 1100");
            Assert.AreEqual(EnemyRoster.Get("aoyin").prefab, EnemyRoster.Get("leiyak").prefab, "雷牦复用獓狠的模型");
            Assert.AreEqual(0.72f, EnemyRoster.Get("leiyak").scale, 1e-4f);
        }

        /// <summary>极简 JSON 解析（测试程序集没有 Newtonsoft）：对象 → Dictionary、数组 → List、数字 → double</summary>
        static class MiniJson
        {
            public static object Parse(string s)
            {
                int i = 0;
                var v = Value(s, ref i);
                return v;
            }

            static void Ws(string s, ref int i)
            {
                while (i < s.Length && char.IsWhiteSpace(s[i])) i++;
            }

            static object Value(string s, ref int i)
            {
                Ws(s, ref i);
                char c = s[i];
                if (c == '{')
                {
                    var d = new Dictionary<string, object>();
                    i++;
                    Ws(s, ref i);
                    if (s[i] == '}')
                    {
                        i++;
                        return d;
                    }
                    while (true)
                    {
                        Ws(s, ref i);
                        var k = Str(s, ref i);
                        Ws(s, ref i);
                        i++; // :
                        d[k] = Value(s, ref i);
                        Ws(s, ref i);
                        if (s[i++] == '}') return d;
                    }
                }
                if (c == '[')
                {
                    var l = new List<object>();
                    i++;
                    Ws(s, ref i);
                    if (s[i] == ']')
                    {
                        i++;
                        return l;
                    }
                    while (true)
                    {
                        l.Add(Value(s, ref i));
                        Ws(s, ref i);
                        if (s[i++] == ']') return l;
                    }
                }
                if (c == '"') return Str(s, ref i);
                if (s.Substring(i).StartsWith("true"))
                {
                    i += 4;
                    return true;
                }
                if (s.Substring(i).StartsWith("false"))
                {
                    i += 5;
                    return false;
                }
                if (s.Substring(i).StartsWith("null"))
                {
                    i += 4;
                    return null;
                }
                int j = i;
                while (j < s.Length && "+-0123456789.eE".IndexOf(s[j]) >= 0) j++;
                var num = double.Parse(s.Substring(i, j - i), CultureInfo.InvariantCulture);
                i = j;
                return num;
            }

            static string Str(string s, ref int i)
            {
                var sb = new StringBuilder();
                i++; // "
                while (s[i] != '"')
                {
                    if (s[i] == '\\')
                    {
                        i++;
                        char e = s[i];
                        if (e == 'u')
                        {
                            sb.Append((char)Convert.ToInt32(s.Substring(i + 1, 4), 16));
                            i += 4;
                        }
                        else sb.Append(e switch { 'n' => '\n', 't' => '\t', 'r' => '\r', _ => e });
                    }
                    else sb.Append(s[i]);
                    i++;
                }
                i++;
                return sb.ToString();
            }
        }
    }
}
