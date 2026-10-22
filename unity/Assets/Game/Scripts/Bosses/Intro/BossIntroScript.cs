using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>镜头运动的缓动（Smoother = 五次 smootherstep：两端速度、加速度都为 0，落回第一人称用它）</summary>
    public enum IntroEase { Linear, In, Out, InOut, Smoother }

    /// <summary>
    /// 镜头表里的一个点：锚点 + 偏移（docs/level-design/boss-intros.md「坐标」）。
    /// 偏移在<b>决斗坐标系</b>里：+Z = 从玩家指向首领出生点（演出开始那一刻、水平），+X = 玩家的右手，+Y = 上。
    /// 所以「首领正前方 8 m、偏右 3 m、离地 1.5 m」写成 At(Anchors.Boss, 3, 1.5f, -8)。
    /// sized = 偏移乘首领体型系数 <see cref="BossIntroContext.Size"/>（身高 4 m = 1）：特写跟着体型自动拉远拉近。
    /// </summary>
    [Serializable]
    public struct IntroPoint
    {
        public string anchor;
        public Vector3 offset;
        public bool sized;

        public IntroPoint(string anchor, Vector3 offset, bool sized = false)
        {
            this.anchor = anchor;
            this.offset = offset;
            this.sized = sized;
        }

        public static IntroPoint At(string anchor, float x = 0, float y = 0, float z = 0) => new(anchor, new Vector3(x, y, z));
        public static IntroPoint Sized(string anchor, float x = 0, float y = 0, float z = 0) => new(anchor, new Vector3(x, y, z), true);
        public bool Valid => !string.IsNullOrEmpty(anchor);
        public override string ToString() => $"{anchor}{(sized ? "×体型" : "")}{offset}";
    }

    /// <summary>内置锚点名（脚本可以在 <see cref="BossIntroScript.anchors"/> 里再加自己的：泉眼、冰窟、熔池、吊鼎…）</summary>
    public static class IntroAnchors
    {
        /// <summary>首领出生点（地面）；没有场地时是首领关物体的位置</summary>
        public const string Spawn = "spawn";
        /// <summary>场地中心（地面）</summary>
        public const string Center = "center";
        /// <summary>首领根节点（实时；生成前 = 出生点）</summary>
        public const string Boss = "boss";
        /// <summary>首领身体中心（角色胶囊中心，实时；生成前 = 出生点上方 2 m）</summary>
        public const string Body = "body";
        /// <summary>首领头骨（实时；没有头骨 = 身体中心往上半个身高）</summary>
        public const string Head = "head";
        /// <summary>首领模型的视觉中心（模型根节点 + 半个身高，实时）：魔将从高空砸落、麒麟跃出熔池时胶囊不动、模型在动，跟拍用它</summary>
        public const string Model = "model";
        /// <summary>玩家脚底（实时）</summary>
        public const string Player = "player";
        /// <summary>玩家眼睛（motor.eye，实时）</summary>
        public const string Eye = "eye";

        public static readonly string[] BuiltIn = { Spawn, Center, Boss, Body, Head, Model, Player, Eye };

        public static bool IsBuiltIn(string name) => Array.IndexOf(BuiltIn, name) >= 0;
    }

    /// <summary>
    /// 一个镜头（docs/level-design/boss-intros.md「镜头表」）：seconds 秒内机位从 from 走到 to、看点从 lookFrom 走到 lookTo、视角 fovFrom → fovTo（按 <see cref="ease"/>）。
    ///   blendIn &gt; 0：开头这么多秒从上一镜（第一镜 = 玩家第一人称）平滑接过来；0 = 硬切。
    ///   orbit：机位绕着看点转（摇臂 / 环绕：水平方向球面插值、距离和高度线性插值），不走直线。
    ///   handheld：轻微手持晃动（0–1），clearance：机位被地形 / 墙挡住时往看点那边收（默认开）。
    /// 链式写法：IntroShot.Make("rise", 2.2f).Move(a, b).Look(c).Fov(50, 44)…
    /// </summary>
    public sealed class IntroShot
    {
        public string name;
        public float seconds = 2f;
        public IntroPoint from, to, lookFrom, lookTo;
        public float fovFrom = 50f, fovTo = 50f;
        public float rollFrom, rollTo;
        public IntroEase ease = IntroEase.InOut;
        public float blendIn;
        public float handheld = 0.15f;
        public bool orbit;
        public bool clearance = true;

        public static IntroShot Make(string name, float seconds) => new() { name = name, seconds = seconds };

        public IntroShot Move(IntroPoint a, IntroPoint b)
        {
            from = a;
            to = b;
            return this;
        }

        public IntroShot Hold(IntroPoint p) => Move(p, p);

        public IntroShot Look(IntroPoint a, IntroPoint b)
        {
            lookFrom = a;
            lookTo = b;
            return this;
        }

        public IntroShot Look(IntroPoint p) => Look(p, p);

        public IntroShot Fov(float a, float b)
        {
            fovFrom = a;
            fovTo = b;
            return this;
        }

        public IntroShot Fov(float a) => Fov(a, a);

        public IntroShot Roll(float a, float b)
        {
            rollFrom = a;
            rollTo = b;
            return this;
        }

        public IntroShot Ease(IntroEase e)
        {
            ease = e;
            return this;
        }

        public IntroShot BlendIn(float s)
        {
            blendIn = Mathf.Max(0, s);
            return this;
        }

        public IntroShot Handheld(float k)
        {
            handheld = Mathf.Clamp01(k);
            return this;
        }

        public IntroShot Orbit(bool on = true)
        {
            orbit = on;
            return this;
        }

        public IntroShot NoClearance()
        {
            clearance = false;
            return this;
        }

        public override string ToString() => $"{name} {seconds:F1}s";
    }

    /// <summary>
    /// 演出事件（挂在整段演出的时间轴上，at = 演出开始后的秒数，按游戏时间——慢动作会一起放慢）：
    /// 登场动作、音效、震屏、慢动作、名字卡、闪屏、任意代码（<see cref="Call"/>），或在 [at, until) 里每 every 秒一次（<see cref="Every"/>：泉水翻涌、熔池冒泡）。
    /// essential = 玩家跳过演出时还没放的也要补放（改场地状态的那种）；其余跳过时直接作废。
    /// </summary>
    public sealed class IntroCue
    {
        public const string KindCall = "call", KindAct = "act", KindSfx = "sfx", KindShake = "shake", KindSlowMo = "slowmo", KindNameCard = "namecard", KindFlash = "flash";

        public string kind = KindCall;
        public string label;
        public float at;
        /// <summary>重复事件：在 [at, until) 里每 every 秒放一次（every ≤ 0 = 只放一次）</summary>
        public float until = -1, every;
        public bool essential;
        public Action<BossIntroContext> run;

        public bool Repeats => every > 0 && until > at;

        public static IntroCue Call(float at, string label, Action<BossIntroContext> run, bool essential = false) =>
            new() { at = at, label = label, run = run, essential = essential };

        public static IntroCue Every(float from, float until, float every, string label, Action<BossIntroContext> run) =>
            new() { at = from, until = until, every = Mathf.Max(0.02f, every), label = label, run = run };

        /// <summary>首领播一个动作（Animator 状态名；没有这个状态只警告一次）</summary>
        public static IntroCue Act(float at, string anim, float seconds = 0) =>
            new() { kind = KindAct, at = at, label = "act:" + anim, run = c => c.Act(anim, seconds) };

        /// <summary>在锚点上放一个音效</summary>
        public static IntroCue Sfx(float at, string id, string anchor = IntroAnchors.Body, float volume = 1, float pitch = 1) =>
            new() { kind = KindSfx, at = at, label = "sfx:" + id, run = c => GameAudio.PlayAt(id, c.Anchor(anchor), volume, pitch) };

        /// <summary>震屏（演出镜头也会抖；回到第一人称前会清掉）</summary>
        public static IntroCue Shake(float at, float strength, float seconds = 0.5f) =>
            new() { kind = KindShake, at = at, label = $"shake:{strength:F2}", run = c => CameraShake.Add(strength, seconds) };

        /// <summary>慢动作（经 TimeScaleArbiter，按真实秒数撤销）</summary>
        public static IntroCue SlowMo(float at, float scale, float realSeconds) =>
            new() { kind = KindSlowMo, at = at, label = $"slowmo:{scale:F2}", run = c => c.SlowMo(scale, realSeconds) };

        /// <summary>电影式名字卡（首领名 + 称号 + 脚本的场地小字），seconds 秒后淡出（最晚在落回第一人称时收起）</summary>
        public static IntroCue NameCard(float at, float seconds = 2.4f) =>
            new() { kind = KindNameCard, at = at, label = "namecard", run = c => c.NameCard(seconds) };

        /// <summary>全屏闪光（颜色含 alpha）</summary>
        public static IntroCue Flash(float at, Color color, float seconds = 0.4f) =>
            new() { kind = KindFlash, at = at, label = "flash", run = c => GameUI.ScreenFlash(color, seconds) };

        public override string ToString() => $"{at:F2}s {label ?? kind}";
    }

    /// <summary>
    /// 一只首领的登场演出（docs/level-design/boss-intros.md）：数据驱动的镜头表 + 事件 + 可选的逐帧钩子，由 <see cref="BossIntroDirector"/> 播放。
    /// 一个首领一个文件 Bosses/&lt;Id&gt;/&lt;Id&gt;Intro.cs，写成 [Defs] 子类（构造函数里填表），id = BossDef.id；没有专属演出的首领用 id = <see cref="DefaultId"/> 的通用演出。
    /// 时间轴：0 = 首领关开战（BossEncounter.Begin，接管镜头）→ <see cref="spawnAt"/> 秒生成首领（它自己的登场动作 BossIntroDef 从这一刻起算）
    ///   → 镜头表逐镜播完 → 用 <see cref="landSeconds"/> 秒平滑落回玩家眼睛（位置、朝向、视角插值到第一人称，最后一帧误差为零）→ 交还操作、登场结束、开打。
    /// 玩家跳过时：作废后面的镜头和非必需事件，从当前画面用 <see cref="skipLandSeconds"/> 秒落回第一人称。
    /// </summary>
    public class BossIntroScript : IDef
    {
        public const string DefaultId = "default";

        public string id;
        public string Id => id;
        /// <summary>第几秒生成首领（BossEncounter 等这一刻再刷首领，代替原来的 warnSeconds 预警）</summary>
        public float spawnAt = 1.5f;
        /// <summary>镜头表播完后落回第一人称用几秒；跳过时用几秒</summary>
        public float landSeconds = 1.3f, skipLandSeconds = 0.7f;
        /// <summary>名字卡上方的小字（场地名，如「鸣沙山 · 月牙泉」；空 = 不显示）</summary>
        public string epithet;
        public readonly List<IntroShot> shots = new();
        public readonly List<IntroCue> cues = new();
        /// <summary>脚本自己的锚点（返回 null = 退回首领出生点）</summary>
        public readonly Dictionary<string, Func<BossIntroContext, Vector3?>> anchors = new();
        /// <summary>开始 / 每帧（Update 里，dt = 游戏时间）/ 结束（正常结束、跳过、被打断都会调一次：撤掉临时改动）</summary>
        public Action<BossIntroContext> onBegin, onEnd;
        public Action<BossIntroContext, float> onTick;

        /// <summary>镜头表总长（不含落回第一人称）</summary>
        public float ShotsSeconds
        {
            get
            {
                float s = 0;
                foreach (var shot in shots)
                    if (shot != null)
                        s += Mathf.Max(0, shot.seconds);
                return s;
            }
        }

        /// <summary>整段演出（镜头表 + 落回第一人称）</summary>
        public float Seconds => ShotsSeconds + Mathf.Max(0, landSeconds);

        /// <summary>第 i 镜从第几秒开始</summary>
        public float ShotStart(int index)
        {
            float s = 0;
            for (int i = 0; i < index && i < shots.Count; i++)
                if (shots[i] != null)
                    s += Mathf.Max(0, shots[i].seconds);
            return s;
        }

        /// <summary>演出第 t 秒在哪一镜（local = 镜头内的秒数）；镜头表播完返回 −1（local = 超出的秒数）</summary>
        public int ShotIndexAt(float t, out float local)
        {
            float start = 0;
            for (int i = 0; i < shots.Count; i++)
            {
                float len = shots[i] != null ? Mathf.Max(0, shots[i].seconds) : 0;
                if (t < start + len)
                {
                    local = Mathf.Max(0, t - start);
                    return i;
                }
                start += len;
            }
            local = t - start;
            return -1;
        }

        /// <summary>有没有名字卡事件</summary>
        public bool HasNameCard
        {
            get
            {
                foreach (var c in cues)
                    if (c != null && c.kind == IntroCue.KindNameCard)
                        return true;
                return false;
            }
        }

        /// <summary>某个锚点名有没有定义（内置或脚本的）</summary>
        public bool Knows(string anchor) => IntroAnchors.IsBuiltIn(anchor) || (anchor != null && anchors.ContainsKey(anchor));

        /// <summary>
        /// 自检（EditMode 测试逐个跑）：有镜头、时长为正、点都有锚点且锚点有定义、视角 10–120°、生成时刻在镜头表里、落地时长合理、
        /// 整段 4–11 s（设计目标 6–10 s）、事件时刻在演出内、有名字卡
        /// </summary>
        public List<string> Validate()
        {
            var p = new List<string>();
            if (string.IsNullOrEmpty(id)) p.Add("没有 id");
            if (shots.Count == 0) p.Add("没有镜头");
            for (int i = 0; i < shots.Count; i++)
            {
                var s = shots[i];
                if (s == null)
                {
                    p.Add($"第 {i + 1} 镜为空");
                    continue;
                }
                string n = $"镜头「{s.name ?? (i + 1).ToString()}」";
                if (!(s.seconds > 0.1f) || !float.IsFinite(s.seconds)) p.Add($"{n}时长 {s.seconds}");
                foreach (var (label, pt) in new[] { ("机位起点", s.from), ("机位终点", s.to), ("看点起点", s.lookFrom), ("看点终点", s.lookTo) })
                {
                    if (!pt.Valid) p.Add($"{n}的{label}没有锚点");
                    else if (!Knows(pt.anchor)) p.Add($"{n}的{label}用了没定义的锚点「{pt.anchor}」");
                }
                if (s.fovFrom < 10 || s.fovFrom > 120 || s.fovTo < 10 || s.fovTo > 120) p.Add($"{n}视角 {s.fovFrom}–{s.fovTo} 超出 10–120");
                if (s.blendIn > s.seconds) p.Add($"{n}的过渡 {s.blendIn}s 比镜头还长");
                if (s.handheld < 0 || s.handheld > 1) p.Add($"{n}手持晃动 {s.handheld} 超出 0–1");
            }
            float shotsLen = ShotsSeconds;
            if (spawnAt < 0 || spawnAt > shotsLen) p.Add($"生成时刻 {spawnAt}s 不在镜头表（0–{shotsLen:F1}s）里");
            if (landSeconds < 0.6f || landSeconds > 3f) p.Add($"落回第一人称 {landSeconds}s 不在 0.6–3 s");
            if (skipLandSeconds < 0.3f || skipLandSeconds > 2f) p.Add($"跳过后落回 {skipLandSeconds}s 不在 0.3–2 s");
            if (Seconds < 4f || Seconds > 11f) p.Add($"整段 {Seconds:F1}s 不在 4–11 s（设计 6–10 s）");
            foreach (var c in cues)
            {
                if (c == null || c.run == null)
                {
                    p.Add($"事件 {c?.label ?? "?"} 没有动作");
                    continue;
                }
                if (c.at < 0 || c.at > Seconds) p.Add($"事件 {c} 不在演出时间内");
                if (c.every > 0 && !(c.until > c.at)) p.Add($"重复事件 {c} 的结束时刻不在开始之后");
            }
            if (!HasNameCard) p.Add("没有名字卡事件");
            return p;
        }

        /// <summary>某只首领的演出：专属的，没有就用通用的（都没有为 null）</summary>
        public static BossIntroScript For(string bossId) => Registry<BossIntroScript>.Get(bossId) ?? Registry<BossIntroScript>.Get(DefaultId);

        public static IReadOnlyList<BossIntroScript> All => Registry<BossIntroScript>.All;
    }

    /// <summary>
    /// 通用登场（代理首领、参考首领、以后还没写专属演出的首领）：从玩家眼中拔起、绕出生点一圈俯拍 → 首领现身 → 低机位特写 + 名字卡 → 拉回玩家眼睛。约 6.2 s
    /// </summary>
    [Defs]
    public sealed class DefaultBossIntro : BossIntroScript
    {
        public DefaultBossIntro()
        {
            id = DefaultId;
            spawnAt = 1.4f;
            landSeconds = 1.3f;
            shots.Add(IntroShot.Make("establish", 2.2f)
                .Move(IntroPoint.At(IntroAnchors.Spawn, -10f, 9f, -16f), IntroPoint.At(IntroAnchors.Spawn, 4f, 7f, -15f))
                .Look(IntroPoint.At(IntroAnchors.Spawn, 0, 1.5f, 0), IntroPoint.At(IntroAnchors.Spawn, 0, 2.5f, 0))
                .Fov(58f, 52f).Orbit().BlendIn(0.8f).Handheld(0.15f));
            shots.Add(IntroShot.Make("reveal", 2.7f)
                .Move(IntroPoint.Sized(IntroAnchors.Boss, 2.2f, 0.8f, -6.5f), IntroPoint.Sized(IntroAnchors.Boss, 1.4f, 1.0f, -5f))
                .Look(IntroPoint.At(IntroAnchors.Head))
                .Fov(46f, 38f).Handheld(0.3f));
            // 吼声、登场动作、震屏由首领自己的 BossIntroDef 在生成时放
            cues.Add(IntroCue.Shake(0.3f, 0.25f, 0.8f));
            cues.Add(IntroCue.NameCard(2.6f, 2.2f));
        }
    }
}
