using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 演出脚本看到的上下文（锚点、首领、决斗坐标系、给事件用的动作）。一次演出一个，由 <see cref="BossIntroDirector"/> 建。
    /// 脚本里的临时改动（模型位移 / 缩放 / 发光）都走这里，演出结束、跳过、被打断时由导演统一撤掉。
    /// </summary>
    public sealed class BossIntroContext
    {
        internal BossIntroDirector director;
        internal Transform eye, player;
        CapsuleCollider capsule;

        public BossIntroScript Script { get; internal set; }
        public BossEncounter Encounter { get; internal set; }
        public BossArena Arena { get; internal set; }
        public BossDef Def { get; internal set; }
        /// <summary>演出镜头（导演开着时；预览 / 测试里为 null）——镜头转场的风这类贴着镜头的特效用</summary>
        public Camera Camera => director ? director.Camera : null;
        /// <summary>首领（生成前为 null）</summary>
        public BossBrain Boss { get; private set; }
        /// <summary>演出开始后的秒数（游戏时间）</summary>
        public float Elapsed { get; internal set; }
        /// <summary>首领生成后的秒数（还没生成为 −1）</summary>
        public float SinceSpawn => Boss ? Elapsed - SpawnedAt : -1f;
        public float SpawnedAt { get; private set; } = -1f;
        /// <summary>首领出生点（地面）</summary>
        public Vector3 Spawn { get; internal set; }
        /// <summary>决斗坐标系：Forward = 玩家 → 首领（水平），Right = 玩家右手</summary>
        public Vector3 Forward { get; internal set; } = Vector3.forward;
        public Vector3 Right { get; internal set; } = Vector3.right;
        /// <summary>首领体型系数：身高 / 4 m，夹在 0.6–3.5（生成前为 1）</summary>
        public float Size { get; private set; } = 1f;
        /// <summary>首领身高（米，生成前为 4）</summary>
        public float Height { get; private set; } = 4f;
        /// <summary>玩家跳过了演出</summary>
        public bool Skipped => director && director.Skipped;
        /// <summary>落回第一人称的进度（镜头表里为 0，交还后为 1）：跳过时代码驱动的动作（升起、褪光）按它赶在交还前做完，免得交还后在玩家眼前跳一下</summary>
        public float LandProgress => director ? director.LandProgress : 0f;
        /// <summary>脚本自己的临时状态（每次演出一份）</summary>
        public readonly Dictionary<string, object> Bag = new();

        /// <summary>
        /// 没有导演的上下文（EditMode 测试、镜头预览）：决斗坐标系按玩家脚底 → 出生点；首领、玩家物体都没有（锚点退回出生点附近），事件里的动作什么都不做
        /// </summary>
        public static BossIntroContext Preview(BossIntroScript script, Vector3 playerFeet, Vector3 spawn, BossArena arena = null)
        {
            IntroMath.DuelBasis(playerFeet, spawn, Vector3.forward, out var f, out var r);
            return new BossIntroContext { Script = script, Arena = arena, Spawn = spawn, Forward = f, Right = r, previewPlayer = playerFeet };
        }

        Vector3? previewPlayer;

        internal void BindBoss(BossBrain b)
        {
            Boss = b;
            SpawnedAt = Elapsed;
            capsule = b ? b.GetComponent<CapsuleCollider>() : null;
            RefreshSize();
        }

        internal void RefreshSize()
        {
            if (!Boss || !capsule) return;
            float h = capsule.height * Mathf.Abs(Boss.transform.lossyScale.y);
            if (!(h > 0.1f) || !float.IsFinite(h)) return;
            Height = h;
            Size = Mathf.Clamp(h / 4f, 0.6f, 3.5f);
        }

        /// <summary>决斗坐标系里的偏移 → 世界偏移</summary>
        public Vector3 Duel(Vector3 offset) => IntroMath.ToWorld(offset, Forward, Right);

        public Vector3 Duel(float x, float y, float z) => Duel(new Vector3(x, y, z));

        /// <summary>锚点的世界位置（实时）。脚本锚点返回 null、或没有这个锚点时退回出生点</summary>
        public Vector3 Anchor(string name)
        {
            switch (name)
            {
                case IntroAnchors.Spawn:
                    return Spawn;
                case IntroAnchors.Center:
                    return Arena ? Arena.Center : Spawn;
                case IntroAnchors.Boss:
                    return Boss ? Boss.transform.position : Spawn;
                case IntroAnchors.Body:
                    return Boss ? Boss.BodyCenter : Spawn + Vector3.up * 2f;
                case IntroAnchors.Head:
                {
                    if (!Boss) return Spawn + Vector3.up * 3f;
                    var h = Boss.Model?.Head;
                    // 头骨找不到时 Head 退回模型根：那就按身高估
                    return h && Boss.Model.root && h != Boss.Model.root.transform ? h.position : Boss.BodyCenter + Vector3.up * Height * 0.35f;
                }
                case IntroAnchors.Model:
                {
                    var root = Boss ? Boss.Model?.root : null;
                    return root ? root.transform.position + Vector3.up * Height * 0.5f : Anchor(IntroAnchors.Body);
                }
                case IntroAnchors.Player:
                    return player ? player.position : previewPlayer ?? Spawn - Forward * 20f;
                case IntroAnchors.Eye:
                    return eye ? eye.position : Anchor(IntroAnchors.Player) + Vector3.up * PlayerFactory.EyeHeight;
            }
            if (name != null && Script != null && Script.anchors.TryGetValue(name, out var f) && f != null)
            {
                try
                {
                    var p = f(this);
                    if (p.HasValue && IntroMath.Finite(p.Value)) return p.Value;
                }
                catch (System.Exception e)
                {
                    director?.ReportOnce("anchor:" + name, e);
                }
            }
            return Spawn;
        }

        /// <summary>镜头表里的一个点 → 世界位置</summary>
        public Vector3 Point(in IntroPoint p) => Anchor(p.anchor) + Duel(p.sized ? p.offset * Size : p.offset);

        // ───────────── 给事件 / 逐帧钩子用的动作 ─────────────

        /// <summary>首领播一个动作（没生成时什么都不做）</summary>
        public void Act(string anim, float seconds = 0)
        {
            if (Boss && !Boss.Dead) Boss.PlayAct(anim, seconds);
        }

        /// <summary>演出慢动作（经 TimeScaleArbiter，按真实秒数撤销；演出结束时一定撤销）</summary>
        public void SlowMo(float scale, float realSeconds) => director?.SlowMo(scale, realSeconds);

        /// <summary>电影式名字卡</summary>
        public void NameCard(float seconds) => director?.ShowNameCard(seconds);

        /// <summary>这一帧给首领模型加一个世界位移（Update 里调，LateUpdate 生效、下一帧自动撤销——没有专用动画时用来「从水里升起」「从熔池跃出」）</summary>
        public void OffsetModel(Vector3 worldOffset) => director?.AddModelOffset(worldOffset);

        /// <summary>这一帧把首领模型整体缩放 k 倍（同上，下一帧撤销）</summary>
        public void ScaleModel(float k) => director?.AddModelScale(k);

        /// <summary>首领身上叠一层发光色（amount 0–1；演出结束时撤掉）</summary>
        public void Overlay(Color color, float amount)
        {
            if (!Boss || !Boss.Body) return;
            if (amount > 0.001f) Boss.Body.SetOverlay(BossIntroDirector.OverlayChannel, color, Mathf.Clamp01(amount));
            else Boss.Body.ClearOverlay(BossIntroDirector.OverlayChannel);
        }

        /// <summary>首领的主发光通道（前摇发光）目标亮度</summary>
        public void Glow(float value)
        {
            if (Boss && !Boss.Dead) Boss.Glow(0, value);
        }

        /// <summary>随机数（演出专用，不动局内随机流）</summary>
        public float Random(float min, float max) => UnityEngine.Random.Range(min, max);
    }
}
